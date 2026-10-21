// Рабочее окно конвертера. Главный процесс присылает задания (байты файла + что сделать),
// окно отвечает байтами результата. Тут есть то, чего нет в Node: canvas с декодерами
// JPG/PNG/WebP/GIF/BMP/AVIF и кодировщиками JPG/PNG/WebP, и отрисовка PDF через pdf.js.
import * as pdfjs from '../node_modules/pdfjs-dist/build/pdf.mjs'

pdfjs.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.mjs'
const STANDARD_FONTS = new URL('../node_modules/pdfjs-dist/standard_fonts/', location.href).href

const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

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
    return { data: await encode(canvas, to, quality), width: canvas.width, height: canvas.height }
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

window.familiar.onJob(async (job) => {
  try {
    window.familiar.jobDone(job.id, await ops[job.op](job))
  } catch (err) {
    window.familiar.jobDone(job.id, { error: err.message || String(err) })
  }
})
window.familiar.workerReady()
