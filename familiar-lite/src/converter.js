// Рабочее окно конвертера. Главный процесс присылает задания (байты файла + что сделать),
// окно отвечает байтами результата. Тут есть то, чего нет в Node: canvas с декодерами
// JPG/PNG/WebP/GIF/BMP/AVIF и кодировщиками JPG/PNG/WebP, и отрисовка PDF через pdf.js.
import * as pdfjs from '../node_modules/pdfjs-dist/build/pdf.mjs'

pdfjs.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.mjs'
const STANDARD_FONTS = new URL('../node_modules/pdfjs-dist/standard_fonts/', location.href).href

const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
// Эти форматы canvas сохранять не умеет — отдаём пиксели, файл собирает lib/encoders.js
const RAW = new Set(['bmp', 'tif', 'gif'])
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

// Картинка → ImageBitmap. imageOrientation учитывает поворот из EXIF (фото с телефона)
const decode = (bytes, mime) => createImageBitmap(new Blob([bytes], { type: mime }), { imageOrientation: 'from-image' })

async function encode(canvas, to, quality) {
  const blob = await canvas.convertToBlob({ type: MIME[to], quality })
  return new Uint8Array(await blob.arrayBuffer())
}

// Нарисовать картинку с преобразованиями: поворот, обрезка до квадрата, масштаб
function draw(img, { rotate = 0, square = false, scale = 1, maxSide = 0, background = null } = {}) {
  let sx = 0
  let sy = 0
  let sw = img.width
  let sh = img.height
  if (square) {
    const side = Math.min(sw, sh)
    sx = (sw - side) / 2
    sy = (sh - side) / 2
    sw = sh = side
  }
  if (maxSide) scale = Math.min(scale, maxSide / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * scale))
  const h = Math.max(1, Math.round(sh * scale))
  const turned = rotate % 180 !== 0
  const canvas = new OffscreenCanvas(turned ? h : w, turned ? w : h)
  const ctx = canvas.getContext('2d')
  if (background) {
    // JPG не умеет прозрачность — подкладываем белый, иначе прозрачное станет чёрным
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((rotate * Math.PI) / 180)
  ctx.drawImage(img, sx, sy, sw, sh, -w / 2, -h / 2, w, h)
  return canvas
}

// Попиксельные фильтры: автоуровни (растянуть яркость каждого канала) и чёрно-белое
function filter(canvas, { levels = false, gray = false }) {
  if (!levels && !gray) return
  const ctx = canvas.getContext('2d')
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = image.data
  const lo = [0, 0, 0]
  const hi = [255, 255, 255]
  if (levels) {
    // Границы — 0.5% самых тёмных и самых светлых пикселей каждого канала
    for (let c = 0; c < 3; c++) {
      const hist = new Uint32Array(256)
      for (let i = c; i < d.length; i += 4) hist[d[i]]++
      const cut = (d.length / 4) * 0.005
      let acc = 0
      for (lo[c] = 0; lo[c] < 255 && (acc += hist[lo[c]]) < cut; lo[c]++);
      acc = 0
      for (hi[c] = 255; hi[c] > 0 && (acc += hist[hi[c]]) < cut; hi[c]--);
      if (hi[c] - lo[c] < 32) (lo[c] = 0), (hi[c] = 255) // почти однотонный канал не трогаем
    }
  }
  const lut = [0, 1, 2].map((c) => {
    const t = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) t[v] = ((v - lo[c]) * 255) / (hi[c] - lo[c])
    return t
  })
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[0][d[i]]
    let g = lut[1][d[i + 1]]
    let b = lut[2][d[i + 2]]
    if (gray) r = g = b = 0.2126 * r + 0.7152 * g + 0.0722 * b
    d[i] = r
    d[i + 1] = g
    d[i + 2] = b
  }
  ctx.putImageData(image, 0, 0)
}

const ops = {
  // Перекодировать картинку с преобразованиями
  async image({ data, mime, to, quality = 0.9, transform = {} }) {
    const img = await decode(data, mime)
    const canvas = draw(img, { ...transform, background: to === 'jpg' ? '#fff' : null })
    filter(canvas, transform)
    if (RAW.has(to)) {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      return { rgba: new Uint8Array(pixels.buffer), width: canvas.width, height: canvas.height }
    }
    return { data: await encode(canvas, to, quality), width: canvas.width, height: canvas.height }
  },

  // Значок: квадрат каждого стандартного размера (не больше самой картинки), по центру, PNG
  async ico({ data, mime }) {
    const img = await decode(data, mime)
    const top = Math.min(256, Math.max(img.width, img.height))
    const images = []
    for (const size of ICO_SIZES.filter((s) => s <= top || s === 16)) {
      const canvas = new OffscreenCanvas(size, size)
      const ctx = canvas.getContext('2d')
      const k = size / Math.max(img.width, img.height)
      const w = Math.max(1, Math.round(img.width * k))
      const h = Math.max(1, Math.round(img.height * k))
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
      images.push({ size, png: await encode(canvas, 'png') })
    }
    return { images }
  },

  // Уменьшенная картинка пикселями — по ней подбирается палитра «Из обоев»
  async pixels({ data, mime, width = 96 }) {
    const img = await decode(data, mime)
    const canvas = draw(img, { scale: width / img.width })
    const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    return { rgba: new Uint8Array(d.buffer), width: canvas.width, height: canvas.height }
  },

  // Картинка из PDF → JPEG поменьше (для «Сжать PDF»). Приходит либо JPEG, либо пиксели
  async jpeg({ image, maxSide, quality }) {
    let src
    if (image.jpeg) src = await decode(image.jpeg, 'image/jpeg')
    else {
      const { data, width, height, channels } = image
      const rgba = new Uint8ClampedArray(width * height * 4)
      for (let i = 0; i < width * height; i++) {
        const c = channels === 1 ? [data[i], data[i], data[i]] : [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]
        rgba.set(c, i * 4)
        rgba[i * 4 + 3] = 255
      }
      src = await createImageBitmap(new ImageData(rgba, width, height))
    }
    const canvas = draw(src, { maxSide, background: '#fff' })
    return { data: await encode(canvas, 'jpg', quality), width: canvas.width, height: canvas.height }
  },

  // Сжать до целевого размера: подбираем качество двоичным поиском,
  // а если не хватает и на минимальном — уменьшаем картинку
  async compress({ data, mime, to, quality, targetBytes }) {
    const img = await decode(data, mime)
    let scale = 1
    for (let attempt = 0; attempt < 8; attempt++) {
      const canvas = draw(img, { scale, background: to === 'jpg' ? '#fff' : null })
      if (!targetBytes) return { data: await encode(canvas, to, quality), width: canvas.width, height: canvas.height }
      let lo = 0.35
      let hi = 0.92
      let best = null
      for (let i = 0; i < 7; i++) {
        const q = (lo + hi) / 2
        const bytes = await encode(canvas, to, q)
        if (bytes.length <= targetBytes) (best = bytes), (lo = q)
        else hi = q
      }
      if (best) return { data: best, width: canvas.width, height: canvas.height }
      scale *= 0.8
    }
    throw new Error('Не получилось сжать до нужного размера')
  },

  // Страницы PDF → картинки
  async pdfPages({ data, to, dpi = 150, quality = 0.9 }) {
    const pdf = await pdfjs.getDocument({ data, standardFontDataUrl: STANDARD_FONTS }).promise
    const pages = []
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale: dpi / 72 })
      const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      pages.push(await encode(canvas, to, quality))
      page.cleanup()
    }
    await pdf.destroy()
    return { pages }
  }
}

// ---------- PDF → Word ----------
// Текст со страниц собираем в строки и абзацы, крупный шрифт — в заголовки,
// картинки — на свои места по высоте. Как у оригинала: одна страница PDF — одна страница Word

// Матрица 2×3, как в PDF: [a b c d e f]
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
]

const objGet = (objs, id) => new Promise((resolve) => {
  try {
    objs.get(id, resolve)
  } catch {
    resolve(null)
  }
})

// Объект картинки pdf.js → PNG (или JPEG, если это крупное фото — Word-файл не раздуется)
async function imageBytes(obj) {
  if (!obj?.width || !obj?.height) return null
  const canvas = new OffscreenCanvas(obj.width, obj.height)
  const ctx = canvas.getContext('2d')
  if (obj.bitmap) ctx.drawImage(obj.bitmap, 0, 0)
  else if (obj.data) {
    const rgba = new Uint8ClampedArray(obj.width * obj.height * 4)
    const d = obj.data
    if (obj.kind === 3) rgba.set(d.subarray(0, rgba.length))
    else if (obj.kind === 2)
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) (rgba[i] = d[j]), (rgba[i + 1] = d[j + 1]), (rgba[i + 2] = d[j + 2]), (rgba[i + 3] = 255)
    else if (obj.kind === 1) {
      // 1 бит на точку, строки выровнены по байту
      const row = (obj.width + 7) >> 3
      for (let y = 0; y < obj.height; y++)
        for (let x = 0; x < obj.width; x++) {
          const v = (d[y * row + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0
          rgba.set([v, v, v, 255], (y * obj.width + x) * 4)
        }
    } else return null
    ctx.putImageData(new ImageData(rgba, obj.width, obj.height), 0, 0)
  } else return null
  const photo = obj.width * obj.height > 250000
  return { type: photo ? 'jpg' : 'png', data: await encode(canvas, photo ? 'jpg' : 'png', 0.88), width: obj.width, height: obj.height }
}

async function pageBlocks(page) {
  const ops = await page.getOperatorList()
  const content = await page.getTextContent()
  const blocks = []

  // Картинки: следим за матрицей преобразования, чтобы знать, где картинка стоит на странице
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack = []
  const seen = new Set()
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i]
    if (fn === pdfjs.OPS.save) stack.push(ctm)
    else if (fn === pdfjs.OPS.restore) ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
    else if (fn === pdfjs.OPS.transform) ctm = mul(ctm, args)
    else if (fn === pdfjs.OPS.paintFormXObjectBegin && args?.[0]) {
      stack.push(ctm)
      ctm = mul(ctm, args[0])
    } else if (fn === pdfjs.OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm
    else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
      const id = args[0]
      if (typeof id === 'string' && seen.has(id)) continue
      const obj = typeof id === 'string' ? await objGet(id.startsWith('g_') ? page.commonObjs : page.objs, id) : id
      if (typeof id === 'string') seen.add(id)
      const img = await imageBytes(obj)
      if (!img) continue
      const w = Math.hypot(ctm[0], ctm[1])
      const h = Math.hypot(ctm[2], ctm[3])
      if (w < 12 || h < 12) continue // точки-разделители и прочая мелочь
      blocks.push({ kind: 'image', top: Math.max(ctm[5], ctm[5] + ctm[3]), widthPt: w, heightPt: h, ...img })
    }
  }

  // Текст: кусочки → строки (по высоте) → абзацы (по расстоянию и размеру шрифта)
  const fonts = new Map()
  const fontInfo = async (fontName) => {
    if (!fonts.has(fontName)) {
      const f = await objGet(page.commonObjs, fontName)
      const n = `${f?.name ?? ''}`
      fonts.set(fontName, { bold: !!f?.bold || /bold|black|heavy|semibold/i.test(n), italic: !!f?.italic || /italic|oblique/i.test(n) })
    }
    return fonts.get(fontName)
  }
  const items = []
  for (const it of content.items) {
    if (!it.str || !it.transform) continue
    const size = Math.round((it.height || Math.hypot(it.transform[2], it.transform[3])) * 10) / 10
    items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, size, eol: it.hasEOL, ...(await fontInfo(it.fontName)) })
  }
  items.sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []
  for (const it of items) {
    const line = lines.at(-1)
    if (line && Math.abs(line.y - it.y) < Math.max(2, line.size * 0.5)) {
      const last = line.items.at(-1)
      const gap = it.x - (last.x + last.w)
      if (gap > it.size * 0.2 && !line.text.endsWith(' ') && !it.str.startsWith(' ')) line.text += ' '
      line.text += it.str
      line.items.push(it)
      line.size = Math.max(line.size, it.size)
    } else lines.push({ y: it.y, size: it.size, text: it.str, items: [it] })
  }
  for (const line of lines) {
    line.text = line.text.replace(/\s+/g, ' ').trim()
    const chars = line.items.reduce((n, i) => n + i.str.length, 0)
    line.bold = line.items.reduce((n, i) => n + (i.bold ? i.str.length : 0), 0) > chars * 0.6
    line.italic = line.items.reduce((n, i) => n + (i.italic ? i.str.length : 0), 0) > chars * 0.6
  }
  const paragraphs = []
  for (const line of lines.filter((l) => l.text)) {
    const p = paragraphs.at(-1)
    const bullet = /^([•·▪\-–—*]|\d+[.)])\s/.test(line.text)
    const close = p && p.lastY - line.y < Math.max(p.size, line.size) * 1.65
    const sameStyle = p && Math.abs(p.size - line.size) <= p.size * 0.12 && p.bold === line.bold
    if (p && close && sameStyle && !bullet) {
      // Перенос по слогам на конце строки склеиваем обратно
      p.text = /[а-яёa-z]-$/i.test(p.text) && /^[а-яёa-z]/.test(line.text) ? p.text.slice(0, -1) + line.text : `${p.text} ${line.text}`
      p.lastY = line.y
    } else paragraphs.push({ kind: 'text', top: line.y + line.size, lastY: line.y, size: line.size, bold: line.bold, italic: line.italic, text: line.text })
  }
  blocks.push(...paragraphs)
  // Сверху вниз (в PDF ось Y смотрит вверх)
  blocks.sort((a, b) => b.top - a.top)
  return blocks
}

ops.pdfDocx = async ({ data }) => {
  const pdf = await pdfjs.getDocument({ data, standardFontDataUrl: STANDARD_FONTS }).promise
  const pages = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    pages.push({ width: page.view[2] - page.view[0], blocks: await pageBlocks(page) })
    page.cleanup()
  }
  await pdf.destroy()
  return { pages }
}

window.familiar.onJob(async (job) => {
  try {
    window.familiar.jobDone(job.id, await ops[job.op](job))
  } catch (err) {
    window.familiar.jobDone(job.id, { error: err.message || String(err) })
  }
})
window.familiar.workerReady()
