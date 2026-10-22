// Форматы, которые canvas сохранять не умеет: BMP, TIFF, GIF и ICO.
// На входе — пиксели RGBA (4 байта на точку, слева направо, сверху вниз), на выходе — файл.
// Всё на чистом JS, без сторонних библиотек: форматы старые и простые.

// ---------- BMP ----------
// 24 бита, без прозрачности (как и у оригинала: прозрачное — на белом)

function bmp({ data, width, height }) {
  const row = Math.ceil((width * 3) / 4) * 4 // строки выровнены по 4 байта
  const size = 54 + row * height
  const out = Buffer.alloc(size)
  out.write('BM', 0, 'latin1')
  out.writeUInt32LE(size, 2)
  out.writeUInt32LE(54, 10) // где начинаются пиксели
  out.writeUInt32LE(40, 14) // BITMAPINFOHEADER
  out.writeInt32LE(width, 18)
  out.writeInt32LE(height, 22) // положительная высота — строки снизу вверх
  out.writeUInt16LE(1, 26)
  out.writeUInt16LE(24, 28)
  out.writeUInt32LE(row * height, 34)
  out.writeInt32LE(3780, 38) // 96 dpi
  out.writeInt32LE(3780, 42)
  for (let y = 0; y < height; y++) {
    let o = 54 + (height - 1 - y) * row
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const a = data[i + 3] / 255
      // Порядок в BMP — синий, зелёный, красный
      out[o++] = Math.round(data[i + 2] * a + 255 * (1 - a))
      out[o++] = Math.round(data[i + 1] * a + 255 * (1 - a))
      out[o++] = Math.round(data[i] * a + 255 * (1 - a))
    }
  }
  return out
}

// ---------- TIFF ----------
// RGB или RGBA, сжатие LZW — его читают все: Windows, Photoshop, принтеры

// LZW по правилам TIFF: коды от 9 до 12 бит, старший бит первым, «ранняя смена» ширины
function lzwTiff(bytes) {
  const out = []
  let acc = 0
  let bits = 0
  const put = (code, width) => {
    acc = (acc << width) | code
    bits += width
    while (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 0xff)
      bits -= 8
    }
    acc &= (1 << bits) - 1
  }
  const CLEAR = 256
  const EOI = 257
  let dict = new Map()
  let next = 258
  let width = 9
  put(CLEAR, width)
  let w = -1
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]
    if (w < 0) {
      w = c
      continue
    }
    const key = w * 256 + c
    const found = dict.get(key)
    if (found !== undefined) {
      w = found
      continue
    }
    put(w, width)
    dict.set(key, next++)
    w = c
    // Читатель отстаёт от нас на одну запись словаря, а TIFF меняет ширину на код раньше GIF
    if (width < 12 && next >= 1 << width) width++
    else if (next >= 4094) {
      // Словарь полон — начинаем заново
      put(CLEAR, width)
      dict = new Map()
      next = 258
      width = 9
    }
  }
  if (w >= 0) put(w, width)
  // EOI может сам потребовать новой ширины
  if (next + 1 >= 1 << width && width < 12) width++
  put(EOI, width)
  if (bits) put(0, 8 - bits)
  return Buffer.from(out)
}

function tiff({ data, width, height }) {
  let alpha = false
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { alpha = true; break }
  const spp = alpha ? 4 : 3
  // Полосами по ~64 КБ — так TIFF и задуман, и читалкам проще
  const rowBytes = width * spp
  const rowsPerStrip = Math.max(1, Math.floor(65536 / rowBytes))
  const strips = []
  for (let y = 0; y < height; y += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, height - y)
    const raw = Buffer.alloc(rows * rowBytes)
    for (let r = 0; r < rows; r++)
      for (let x = 0; x < width; x++) {
        const i = ((y + r) * width + x) * 4
        const o = r * rowBytes + x * spp
        raw[o] = data[i]
        raw[o + 1] = data[i + 1]
        raw[o + 2] = data[i + 2]
        if (alpha) raw[o + 3] = data[i + 3]
      }
    strips.push(lzwTiff(raw))
  }

  // Теги (должны идти по возрастанию номера): [номер, тип, значения]. Тип 3 — SHORT, 4 — LONG, 5 — RATIONAL
  const SHORT = 3
  const LONG = 4
  const RATIONAL = 5
  const tags = [
    [256, LONG, [width]],
    [257, LONG, [height]],
    [258, SHORT, Array(spp).fill(8)],
    [259, SHORT, [5]], // LZW
    [262, SHORT, [2]], // RGB
    [273, LONG, null], // смещения полос — заполним ниже
    [277, SHORT, [spp]],
    [278, LONG, [rowsPerStrip]],
    [279, LONG, strips.map((s) => s.length)],
    [282, RATIONAL, [96, 1]],
    [283, RATIONAL, [96, 1]],
    [284, SHORT, [1]],
    [296, SHORT, [2]], // дюймы
    ...(alpha ? [[338, SHORT, [2]]] : []) // альфа без premultiply
  ]
  const size = (type) => (type === SHORT ? 2 : type === LONG ? 4 : 8)
  const count = (t) => (t[1] === RATIONAL ? t[2].length / 2 : (t[2] ?? strips).length)
  const ifdSize = 2 + tags.length * 12 + 4
  // Данные тегов, что не влезли в 4 байта, — сразу после IFD
  let extra = 8 + ifdSize
  const extraAt = new Map()
  for (const t of tags) {
    const bytes = count(t) * size(t[1])
    if (bytes > 4) {
      extraAt.set(t[0], extra)
      extra += bytes + (bytes % 2)
    }
  }
  let offset = extra
  const stripOffsets = strips.map((s) => {
    const o = offset
    offset += s.length
    return o
  })
  tags.find((t) => t[0] === 273)[2] = stripOffsets

  const out = Buffer.alloc(offset)
  out.write('II', 0, 'latin1')
  out.writeUInt16LE(42, 2)
  out.writeUInt32LE(8, 4)
  out.writeUInt16LE(tags.length, 8)
  const writeValues = (t, at) => {
    const values = t[2]
    for (let i = 0; i < values.length; i++) {
      if (t[1] === SHORT) out.writeUInt16LE(values[i], at + i * 2)
      else out.writeUInt32LE(values[i], at + i * 4)
    }
  }
  tags.forEach((t, i) => {
    const e = 10 + i * 12
    out.writeUInt16LE(t[0], e)
    out.writeUInt16LE(t[1], e + 2)
    out.writeUInt32LE(count(t), e + 4)
    if (extraAt.has(t[0])) {
      out.writeUInt32LE(extraAt.get(t[0]), e + 8)
      writeValues(t, extraAt.get(t[0]))
    } else writeValues(t, e + 8)
  })
  out.writeUInt32LE(0, 10 + tags.length * 12) // следующего IFD нет
  strips.forEach((s, i) => s.copy(out, stripOffsets[i]))
  return out
}

// ---------- GIF ----------
// Только 256 цветов: подбираем палитру «медианным сечением» и сглаживаем переходы
// рассеиванием ошибки (Флойд — Стейнберг), иначе на градиентах будут полосы

function medianCut(data, maxColors) {
  // Гистограмма по 5 бит на канал — 32768 корзин, быстро и достаточно точно
  const hist = new Uint32Array(32768)
  const sums = new Float64Array(32768 * 3) // точные суммы цветов в корзине — для итогового цвета
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const k = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
    hist[k]++
    sums[k * 3] += data[i]
    sums[k * 3 + 1] += data[i + 1]
    sums[k * 3 + 2] += data[i + 2]
  }
  const colors = []
  for (let k = 0; k < 32768; k++) if (hist[k]) colors.push(k)
  if (!colors.length) return [[0, 0, 0]]
  const ch = (k, c) => (k >> (10 - c * 5)) & 31
  const boxes = [colors]
  while (boxes.length < maxColors) {
    // Делим коробку с самым большим разбросом
    let best = -1
    let bestRange = 0
    let bestCh = 0
    boxes.forEach((box, b) => {
      if (box.length < 2) return
      for (let c = 0; c < 3; c++) {
        let lo = 31
        let hi = 0
        for (const k of box) {
          const v = ch(k, c)
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
        if (hi - lo > bestRange) (bestRange = hi - lo), (best = b), (bestCh = c)
      }
    })
    if (best < 0) break
    const box = boxes[best].sort((a, b) => ch(a, bestCh) - ch(b, bestCh))
    // Режем по медиане с учётом того, сколько точек в каждой корзине
    let total = 0
    for (const k of box) total += hist[k]
    let acc = 0
    let cut = 1
    for (; cut < box.length - 1; cut++) if ((acc += hist[box[cut - 1]]) >= total / 2) break
    boxes.splice(best, 1, box.slice(0, cut), box.slice(cut))
  }
  return boxes.map((box) => {
    let n = 0
    const sum = [0, 0, 0]
    for (const k of box) {
      n += hist[k]
      for (let c = 0; c < 3; c++) sum[c] += sums[k * 3 + c]
    }
    return sum.map((s) => Math.round(s / n))
  })
}

function lzwGif(indices, minCode) {
  const out = []
  let acc = 0
  let bits = 0
  // В GIF биты идут младшими вперёд
  const put = (code, width) => {
    acc |= code << bits
    bits += width
    while (bits >= 8) {
      out.push(acc & 0xff)
      acc >>>= 8
      bits -= 8
    }
  }
  const CLEAR = 1 << minCode
  const EOI = CLEAR + 1
  let width = minCode + 1
  let dict = new Map()
  let next = EOI + 1
  put(CLEAR, width)
  let w = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i]
    const key = w * 4096 + c
    const found = dict.get(key)
    if (found !== undefined) {
      w = found
      continue
    }
    put(w, width)
    if (next < 4096) {
      dict.set(key, next++)
      if (next > 1 << width && width < 12) width++
    } else {
      put(CLEAR, width)
      dict = new Map()
      next = EOI + 1
      width = minCode + 1
    }
    w = c
  }
  put(w, width)
  if (next >= 1 << width && width < 12) width++
  put(EOI, width)
  if (bits) out.push(acc & 0xff)
  return out
}

function gif({ data, width, height }) {
  let transparent = false
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) { transparent = true; break }
  const palette = medianCut(data, transparent ? 255 : 256)
  const transIndex = transparent ? palette.length : -1
  if (transparent) palette.push([0, 0, 0])
  let bitsPerColor = 1
  while (1 << bitsPerColor < palette.length) bitsPerColor++

  // Ближайший цвет палитры, с кэшем по 5 бит на канал
  const cache = new Int16Array(32768).fill(-1)
  const nearest = (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    if (cache[key] >= 0) return cache[key]
    let best = 0
    let bestD = Infinity
    const n = transparent ? palette.length - 1 : palette.length
    for (let p = 0; p < n; p++) {
      const [pr, pg, pb] = palette[p]
      const d = (pr - r) ** 2 * 2 + (pg - g) ** 2 * 4 + (pb - b) ** 2 * 3
      if (d < bestD) (bestD = d), (best = p)
    }
    cache[key] = best
    return best
  }

  const indices = new Uint8Array(width * height)
  const err = new Float32Array(width * height * 3)
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (transparent && data[p * 4 + 3] < 128) {
        indices[p] = transIndex
        continue
      }
      const r = clamp(data[p * 4] + err[p * 3])
      const g = clamp(data[p * 4 + 1] + err[p * 3 + 1])
      const b = clamp(data[p * 4 + 2] + err[p * 3 + 2])
      const idx = nearest(r | 0, g | 0, b | 0)
      indices[p] = idx
      const e = [r - palette[idx][0], g - palette[idx][1], b - palette[idx][2]]
      const spread = (dx, dy, k) => {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || nx >= width || ny >= height) return
        const q = (ny * width + nx) * 3
        for (let c = 0; c < 3; c++) err[q + c] += e[c] * k
      }
      spread(1, 0, 7 / 16)
      spread(-1, 1, 3 / 16)
      spread(0, 1, 5 / 16)
      spread(1, 1, 1 / 16)
    }

  const out = []
  const u16 = (v) => out.push(v & 0xff, v >> 8)
  out.push(...Buffer.from('GIF89a', 'latin1'))
  u16(width)
  u16(height)
  out.push(0x80 | ((bitsPerColor - 1) << 4) | (bitsPerColor - 1), 0, 0) // общая палитра
  for (let i = 0; i < 1 << bitsPerColor; i++) out.push(...(palette[i] ?? [0, 0, 0]))
  if (transparent) out.push(0x21, 0xf9, 4, 1, 0, 0, transIndex, 0) // какой цвет прозрачный
  out.push(0x2c)
  u16(0)
  u16(0)
  u16(width)
  u16(height)
  out.push(0)
  const minCode = Math.max(2, bitsPerColor)
  out.push(minCode)
  const lzw = lzwGif(indices, minCode)
  for (let i = 0; i < lzw.length; i += 255) {
    const block = lzw.slice(i, i + 255)
    out.push(block.length, ...block)
  }
  out.push(0, 0x3b)
  return Buffer.from(out)
}

// ---------- ICO ----------
// Значок Windows: несколько размеров в одном файле, каждый — PNG (так умеет Windows Vista и новее)

function ico(images) {
  // images: [{ size, png }] по возрастанию размера
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // 1 — значок
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, i) => {
    const e = 6 + i * 16
    header[e] = size >= 256 ? 0 : size // 0 означает 256
    header[e + 1] = size >= 256 ? 0 : size
    header.writeUInt16LE(1, e + 4) // плоскостей
    header.writeUInt16LE(32, e + 6) // бит на точку
    header.writeUInt32LE(png.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map((i) => Buffer.from(i.png))])
}

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

// ---------- PNG ----------
// Нужен там, где нет canvas (главный процесс): картинки, вынутые из PDF.
// channels: 1 — серый, 3 — RGB, 4 — RGBA; по байту на канал

function png({ data, width, height, channels }) {
  const zlib = require('zlib')
  const row = width * channels
  const raw = Buffer.alloc((row + 1) * height)
  for (let y = 0; y < height; y++) {
    // Фильтр «Up» (разница с предыдущей строкой) — сжимается лучше, чем без фильтра
    const o = y * (row + 1)
    raw[o] = y ? 2 : 0
    for (let x = 0; x < row; x++) raw[o + 1 + x] = (data[y * row + x] - (y ? data[(y - 1) * row + x] : 0)) & 0xff
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(body.length, 0)
    head.write(type, 4, 'latin1')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), body])), 0)
    return Buffer.concat([head, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // бит на канал
  ihdr[9] = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels] // тип цвета PNG
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

module.exports = { bmp, tiff, gif, ico, png, ICO_SIZES }
