// Конвертер в духе DragShift (github.com/llamaboi55/DragShift, MIT): потащил файл, нажал Shift,
// бросил на сектор кругового меню — рядом появился результат, оригинал не тронут.
// Здесь — что умеем и как делаем; картинки и страницы PDF рисует рабочее окно (src/converter.js).
const path = require('path')
const fs = require('fs')
const os = require('os')
const { pathToFileURL } = require('url')
const { execFile } = require('child_process')
const { BrowserWindow, ipcMain } = require('electron')
const { readMeta, stripMeta } = require('./imagemeta')

const isWin = process.platform === 'win32'

// ---------- Типы файлов ----------

const KINDS = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'ico'],
  pdf: ['pdf'],
  docx: ['docx'],
  text: ['txt', 'md', 'markdown', 'csv', 'log', 'json', 'xml', 'ini', 'yml', 'yaml']
}
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

const extOf = (p) => path.extname(p).slice(1).toLowerCase()
const kindOfExt = (ext) => Object.keys(KINDS).find((k) => KINDS[k].includes(ext)) ?? null
const kindOf = (p) => kindOfExt(extOf(p))

// Тип по MIME — пока файл ещё тащат, имени не видно, а MIME уже известен
function kindOfMime(mime) {
  if (!mime) return null
  if (mime.startsWith('image/')) return 'image'
  if (mime === MIME.pdf) return 'pdf'
  if (mime === MIME.docx) return 'docx'
  if (mime.startsWith('text/') || mime === 'application/json') return 'text'
  return null
}

// ---------- Действия ----------
// mode: convert — «Конвертация», tools — «Инструменты» (переключаются повторным Shift)

const ACTIONS = {
  image: {
    convert: [
      { id: 'to-jpg', label: 'JPG' },
      { id: 'to-png', label: 'PNG' },
      { id: 'to-webp', label: 'WebP' },
      { id: 'to-pdf', label: 'PDF' }
    ],
    tools: [
      { id: 'compress', label: 'Сжать' },
      { id: 'compress-target', label: '≤ размер' },
      { id: 'resize', label: 'Уменьшить' },
      { id: 'square', label: 'Квадрат' },
      { id: 'enhance', label: 'Улучшить' },
      { id: 'gray', label: 'Ч/Б' },
      { id: 'rotate', label: 'Повернуть' },
      { id: 'clean', label: 'Без метаданных' }
    ]
  },
  pdf: {
    convert: [
      { id: 'pdf-jpg', label: 'JPG' },
      { id: 'pdf-png', label: 'PNG' },
      { id: 'pdf-txt', label: 'TXT' }
    ],
    tools: [
      { id: 'pdf-split', label: 'Разделить' },
      { id: 'pdf-rotate', label: 'Повернуть' },
      { id: 'merge', label: 'Склеить' }
    ]
  },
  docx: {
    convert: [
      { id: 'docx-pdf', label: 'PDF' },
      { id: 'docx-txt', label: 'TXT' }
    ],
    tools: []
  },
  text: {
    convert: [
      { id: 'text-pdf', label: 'PDF' },
      { id: 'text-docx', label: 'DOCX' }
    ],
    tools: []
  }
}

// Набор действий для того, что тащат. Несколько картинок/PDF — можно склеить в один PDF
function actionsFor(kinds) {
  const unique = [...new Set(kinds.filter(Boolean))]
  if (!unique.length) return { convert: [], tools: [] }
  if (unique.length > 1) {
    // Смесь типов: только склеить всё, что умеем, в один PDF
    const mergeable = unique.every((k) => k === 'image' || k === 'pdf')
    return { convert: mergeable ? [{ id: 'merge', label: 'Один PDF' }] : [], tools: [] }
  }
  const set = ACTIONS[unique[0]]
  const many = kinds.length > 1
  return {
    convert: set.convert.map((a) => (many && a.id === 'to-pdf' ? { ...a, label: 'Один PDF' } : a)),
    tools: set.tools.filter((a) => a.id !== 'merge' || many)
  }
}

// ---------- Куда сохранять ----------

function outDir(src, settings) {
  const dir = path.dirname(src)
  if (settings.output !== 'folder') return dir
  const sub = path.join(dir, 'Преобразовано')
  fs.mkdirSync(sub, { recursive: true })
  return sub
}

// «фото.jpg» + «сжато», «webp» → «фото (сжато).webp»; если занято — «фото (сжато) 2.webp»
function outPath(src, suffix, ext, settings, dir = outDir(src, settings)) {
  const base = path.basename(src, path.extname(src)) + (suffix ? ` (${suffix})` : '')
  let p = path.join(dir, `${base}.${ext}`)
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} ${i}.${ext}`)
  return p
}

function write(p, data) {
  fs.writeFileSync(p, Buffer.from(data))
  return p
}

// ---------- Рабочее окно ----------

let worker = null
let workerReady = null
let idleTimer = null
const jobs = new Map()
let jobSeq = 0

ipcMain.on('convert:ready', () => workerReady?.resolve())
ipcMain.on('convert:done', (_e, id, result) => {
  const job = jobs.get(id)
  if (!job) return
  jobs.delete(id)
  result?.error ? job.reject(new Error(result.error)) : job.resolve(result)
})

function startWorker(srcDir, webPreferences) {
  if (worker && !worker.isDestroyed()) return
  let resolve
  workerReady = new Promise((r) => (resolve = r))
  workerReady.resolve = resolve
  // Отдельный процесс: тяжёлая картинка не подвесит виджеты и док
  worker = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { ...webPreferences, backgroundThrottling: false } })
  worker.loadFile(path.join(srcDir, 'converter.html'))
  worker.on('closed', () => (worker = null))
}

async function runJob(ctx, job) {
  startWorker(ctx.srcDir, ctx.webPreferences)
  await workerReady
  clearTimeout(idleTimer)
  const id = ++jobSeq
  const done = new Promise((resolve, reject) => jobs.set(id, { resolve, reject }))
  worker.webContents.send('convert:job', { id, ...job })
  try {
    return await done
  } finally {
    // 2 минуты без заданий — закрываем рабочее окно, память не держим
    idleTimer = setTimeout(() => worker?.destroy(), 2 * 60 * 1000)
  }
}

// ---------- HTML → PDF (для DOCX и текста) ----------

async function htmlToPdf(html) {
  const tmp = path.join(os.tmpdir(), `familiar-print-${process.pid}-${Date.now()}.html`)
  fs.writeFileSync(tmp, html)
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
  try {
    await win.loadFile(tmp)
    return await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'default' } })
  } finally {
    win.destroy()
    fs.rmSync(tmp, { force: true })
  }
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const PRINT_CSS = `
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: 'Segoe UI', 'Noto Sans', Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #111; }
  h1, h2, h3 { line-height: 1.25; margin: 1.2em 0 0.5em; }
  img { max-width: 100%; }
  table { border-collapse: collapse; } td, th { border: 1px solid #bbb; padding: 4px 8px; }
  pre, code { font-family: Consolas, 'DejaVu Sans Mono', monospace; font-size: 9.5pt; }
  pre { white-space: pre-wrap; word-break: break-word; }
`

// Совсем простой Markdown: заголовки, списки, жирный/курсив, код — для конспектов хватает
function markdownToHtml(md) {
  const lines = md.split(/\r?\n/)
  const out = []
  let list = null
  let code = false
  const inline = (s) =>
    escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>')
  for (const line of lines) {
    if (line.startsWith('```')) {
      out.push(code ? '</pre>' : '<pre>')
      code = !code
      continue
    }
    if (code) {
      out.push(escapeHtml(line))
      continue
    }
    const item = line.match(/^\s*([-*]|\d+\.)\s+(.*)/)
    if (item) {
      const tag = /\d/.test(item[1]) ? 'ol' : 'ul'
      if (list !== tag) out.push((list ? `</${list}>` : '') + `<${tag}>`), (list = tag)
      out.push(`<li>${inline(item[2])}</li>`)
      continue
    }
    if (list) out.push(`</${list}>`), (list = null)
    const h = line.match(/^(#{1,3})\s+(.*)/)
    if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`)
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`)
  }
  if (list) out.push(`</${list}>`)
  if (code) out.push('</pre>')
  return out.join('\n')
}

// ---------- Word → PDF ----------
// На Windows с установленным Word — через сам Word (точнее всего), иначе встроенной отрисовкой

const WORD_SCRIPT = `
param($in, $out)
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($in, $false, $true)
  $doc.ExportAsFixedFormat($out, 17)
  $doc.Close($false)
} finally { $word.Quit() }
`

function wordToPdf(src, out) {
  if (!isWin) return Promise.resolve(false)
  const script = path.join(os.tmpdir(), 'familiar-word2pdf.ps1')
  fs.writeFileSync(script, WORD_SCRIPT)
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, src, out], { windowsHide: true, timeout: 120000 }, (err) =>
      resolve(!err && fs.existsSync(out))
    )
  })
}

// ---------- Выполнение ----------

const size = (b) => (b < 1024 ? `${b} Б` : b < 1024 ** 2 ? `${Math.round(b / 1024)} КБ` : `${(b / 1024 ** 2).toFixed(1).replace('.', ',')} МБ`)

function sizeNote(before, after) {
  const delta = Math.round((1 - after / before) * 100)
  return `${size(before)} → ${size(after)}${delta > 0 ? ` (−${delta}%)` : delta < 0 ? ` (+${-delta}%)` : ''}`
}

// Картинку — в рабочее окно, результат — рядом с оригиналом
async function imageJob(ctx, src, { to, suffix, transform, quality }) {
  const data = fs.readFileSync(src)
  const ext = to ?? (['jpg', 'jpeg', 'png', 'webp'].includes(extOf(src)) ? (extOf(src) === 'jpeg' ? 'jpg' : extOf(src)) : 'png')
  const res = await runJob(ctx, { op: 'image', data, mime: MIME[extOf(src)], to: ext, quality: quality ?? ctx.settings.quality, transform })
  const out = write(outPath(src, suffix, ext, ctx.settings), res.data)
  return { out, note: `${res.width}×${res.height}` }
}

// Несколько картинок и PDF → один PDF
async function mergeToPdf(ctx, files, suffix) {
  const { PDFDocument } = require('pdf-lib')
  const doc = await PDFDocument.create()
  for (const f of files) {
    if (kindOf(f) === 'pdf') {
      const src = await PDFDocument.load(fs.readFileSync(f), { ignoreEncryption: true })
      for (const page of await doc.copyPages(src, src.getPageIndices())) doc.addPage(page)
      continue
    }
    // JPG и PNG встраиваются как есть, остальное сначала переводим в PNG
    let bytes = fs.readFileSync(f)
    let ext = extOf(f)
    if (!['jpg', 'jpeg', 'png'].includes(ext)) {
      bytes = Buffer.from((await runJob(ctx, { op: 'image', data: bytes, mime: MIME[ext], to: 'png' })).data)
      ext = 'png'
    }
    const img = ext === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
    // Размер страницы = размер картинки при 96 точках на дюйм
    const page = doc.addPage([img.width * 0.75, img.height * 0.75])
    page.drawImage(img, { x: 0, y: 0, width: img.width * 0.75, height: img.height * 0.75 })
  }
  return write(outPath(files[0], suffix, 'pdf', ctx.settings), await doc.save())
}

// Много страниц — в отдельную папку, чтобы не засыпать файлами рабочий стол
function pagesDir(src, settings, count) {
  if (count <= 3) return outDir(src, settings)
  const base = path.join(outDir(src, settings), `${path.basename(src, path.extname(src))} (страницы)`)
  let dir = base
  for (let i = 2; fs.existsSync(dir); i++) dir = `${base} ${i}`
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

async function pdfText(src) {
  const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href)
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(src)), verbosity: 0 }).promise
  const pages = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent()
    pages.push(content.items.map((i) => i.str + (i.hasEOL ? '\n' : '')).join(''))
  }
  await pdf.destroy()
  return pages.join('\n\n')
}

const handlers = {
  'to-jpg': (ctx, files) => eachFile(files, (f) => imageJob(ctx, f, { to: 'jpg' })),
  'to-png': (ctx, files) => eachFile(files, (f) => imageJob(ctx, f, { to: 'png' })),
  'to-webp': (ctx, files) => eachFile(files, (f) => imageJob(ctx, f, { to: 'webp' })),
  'to-pdf': async (ctx, files) => ({ outputs: [await mergeToPdf(ctx, files)] }),
  merge: async (ctx, files) => ({ outputs: [await mergeToPdf(ctx, files, 'вместе')] }),

  // Сжать: JPG и WebP — с качеством из настроек; PNG сжимается только сменой формата → WebP
  compress: (ctx, files) =>
    eachFile(files, async (f) => {
      const ext = ['jpg', 'jpeg', 'webp'].includes(extOf(f)) ? (extOf(f) === 'webp' ? 'webp' : 'jpg') : 'webp'
      const data = fs.readFileSync(f)
      const res = await runJob(ctx, { op: 'compress', data, mime: MIME[extOf(f)], to: ext, quality: ctx.settings.quality })
      if (res.data.length >= data.length) return { out: null, note: 'уже сжато сильнее — оставил как есть' }
      return { out: write(outPath(f, 'сжато', ext, ctx.settings), res.data), note: sizeNote(data.length, res.data.length) }
    }),

  // Сжать до размера из настроек (по умолчанию 500 КБ) — для сайтов и госуслуг с лимитом
  'compress-target': (ctx, files) =>
    eachFile(files, async (f) => {
      const data = fs.readFileSync(f)
      const targetBytes = ctx.settings.targetKb * 1024
      const ext = extOf(f) === 'webp' ? 'webp' : 'jpg'
      if (data.length <= targetBytes) return { out: null, note: `уже меньше ${ctx.settings.targetKb} КБ` }
      const res = await runJob(ctx, { op: 'compress', data, mime: MIME[extOf(f)], to: ext, targetBytes })
      return { out: write(outPath(f, `до ${ctx.settings.targetKb} КБ`, ext, ctx.settings), res.data), note: sizeNote(data.length, res.data.length) }
    }),

  resize: (ctx, files) => eachFile(files, (f) => imageJob(ctx, f, { suffix: 'уменьшено', transform: { scale: 0.5, maxSide: 1920 } })),
  square: (ctx, files) => eachFile(files, (f) => imageJob(ctx, f, { suffix: 'квадрат', transform: { square: true } })),
  enhance: (ctx, files) => eachFile(files, (f) => imageJob(ctx, f, { suffix: 'улучшено', transform: { levels: true } })),
  gray: (ctx, files) => eachFile(files, (f) => imageJob(ctx, f, { suffix: 'чб', transform: { gray: true } })),
  rotate: (ctx, files) => eachFile(files, (f) => imageJob(ctx, f, { suffix: 'повёрнуто', transform: { rotate: 90 } })),

  // Метаданные: вырезаем без пересжатия; где нельзя (повёрнутый снимок, редкий формат) — перекодируем
  clean: (ctx, files) =>
    eachFile(files, async (f) => {
      const data = fs.readFileSync(f)
      const meta = readMeta(data)
      if (!meta.hasMeta && !meta.unknown) return { out: null, note: 'метаданных нет' }
      const found = [meta.gps && 'геолокация', (meta.make || meta.model) && `камера ${[meta.make, meta.model].filter(Boolean).join(' ')}`, meta.date && 'дата съёмки']
        .filter(Boolean)
        .join(', ')
      const stripped = stripMeta(data)
      const out = stripped
        ? write(outPath(f, 'без метаданных', extOf(f), ctx.settings), stripped)
        : (await imageJob(ctx, f, { suffix: 'без метаданных', quality: 0.95 })).out
      return { out, note: found ? `удалено: ${found}` : 'метаданные удалены' }
    }),

  'pdf-jpg': (ctx, files) => eachFile(files, (f) => pdfToImages(ctx, f, 'jpg')),
  'pdf-png': (ctx, files) => eachFile(files, (f) => pdfToImages(ctx, f, 'png')),
  'pdf-txt': (ctx, files) => eachFile(files, async (f) => ({ out: write(outPath(f, null, 'txt', ctx.settings), await pdfText(f)) })),

  'pdf-split': (ctx, files) =>
    eachFile(files, async (f) => {
      const { PDFDocument } = require('pdf-lib')
      const src = await PDFDocument.load(fs.readFileSync(f), { ignoreEncryption: true })
      const count = src.getPageCount()
      const dir = pagesDir(f, ctx.settings, count)
      const outs = []
      for (let i = 0; i < count; i++) {
        const one = await PDFDocument.create()
        one.addPage((await one.copyPages(src, [i]))[0])
        outs.push(write(outPath(f, `стр. ${i + 1}`, 'pdf', ctx.settings, dir), await one.save()))
      }
      return { outs, note: `${count} стр.` }
    }),

  'pdf-rotate': (ctx, files) =>
    eachFile(files, async (f) => {
      const { PDFDocument, degrees } = require('pdf-lib')
      const doc = await PDFDocument.load(fs.readFileSync(f), { ignoreEncryption: true })
      for (const page of doc.getPages()) page.setRotation(degrees((page.getRotation().angle + 90) % 360))
      return { out: write(outPath(f, 'повёрнуто', 'pdf', ctx.settings), await doc.save()) }
    }),

  'docx-pdf': (ctx, files) =>
    eachFile(files, async (f) => {
      const out = outPath(f, null, 'pdf', ctx.settings)
      if (await wordToPdf(f, out)) return { out, note: 'через Microsoft Word' }
      const mammoth = require('mammoth')
      const { value } = await mammoth.convertToHtml({ path: f })
      const html = `<!doctype html><meta charset="utf-8"><style>${PRINT_CSS}</style>${value}`
      return { out: write(out, await htmlToPdf(html)) }
    }),

  'docx-txt': (ctx, files) =>
    eachFile(files, async (f) => {
      const { value } = await require('mammoth').extractRawText({ path: f })
      return { out: write(outPath(f, null, 'txt', ctx.settings), value) }
    }),

  'text-pdf': (ctx, files) =>
    eachFile(files, async (f) => {
      const text = fs.readFileSync(f, 'utf8')
      const body = ['md', 'markdown'].includes(extOf(f)) ? markdownToHtml(text) : `<pre>${escapeHtml(text)}</pre>`
      const html = `<!doctype html><meta charset="utf-8"><style>${PRINT_CSS}</style>${body}`
      return { out: write(outPath(f, null, 'pdf', ctx.settings), await htmlToPdf(html)) }
    }),

  'text-docx': (ctx, files) =>
    eachFile(files, async (f) => {
      const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx')
      const md = ['md', 'markdown'].includes(extOf(f))
      const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3]
      const children = fs
        .readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .map((line) => {
          const h = md && line.match(/^(#{1,3})\s+(.*)/)
          if (h) return new Paragraph({ text: h[2], heading: levels[h[1].length - 1] })
          return new Paragraph({ children: [new TextRun(line)] })
        })
      const doc = new Document({ sections: [{ children }] })
      return { out: write(outPath(f, null, 'docx', ctx.settings), await Packer.toBuffer(doc)) }
    })
}

async function pdfToImages(ctx, f, to) {
  const res = await runJob(ctx, { op: 'pdfPages', data: fs.readFileSync(f), to, dpi: ctx.settings.dpi, quality: ctx.settings.quality })
  const dir = pagesDir(f, ctx.settings, res.pages.length)
  const outs = res.pages.map((bytes, i) => write(outPath(f, res.pages.length > 1 ? `стр. ${i + 1}` : null, to, ctx.settings, dir), bytes))
  return { outs, note: `${res.pages.length} стр. · ${ctx.settings.dpi} dpi` }
}

// Применить к каждому файлу; собрать все результаты и заметки
async function eachFile(files, fn) {
  const outputs = []
  const notes = []
  for (const f of files) {
    const r = await fn(f)
    if (r.out) outputs.push(r.out)
    if (r.outs) outputs.push(...r.outs)
    if (r.note) notes.push(files.length > 1 ? `${path.basename(f)}: ${r.note}` : r.note)
  }
  return { outputs, note: notes.join(' · ') }
}

async function run(ctx, actionId, files) {
  const handler = handlers[actionId]
  if (!handler) throw new Error(`Неизвестное действие: ${actionId}`)
  const result = await handler(ctx, files)
  const outputs = result.outputs ?? []
  let note = result.note ?? ''
  // Получился один PDF и пояснения нет — подскажем, сколько в нём страниц
  if (!note && outputs.length === 1 && extOf(outputs[0]) === 'pdf') {
    const { PDFDocument } = require('pdf-lib')
    const pages = (await PDFDocument.load(fs.readFileSync(outputs[0]), { ignoreEncryption: true })).getPageCount()
    note = `${pages} стр. · ${size(fs.statSync(outputs[0]).size)}`
  }
  return { outputs, note }
}

const allLabels = Object.fromEntries(
  Object.values(ACTIONS).flatMap((set) => [...set.convert, ...set.tools].map((a) => [a.id, a.label]))
)

module.exports = { KINDS, MIME, kindOf, kindOfMime, actionsFor, run, labelOf: (id) => allLabels[id] ?? id }
