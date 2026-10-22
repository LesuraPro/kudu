// Картинки внутри PDF: достать (инструмент «Картинки») и пережать (инструмент «Сжать»).
// Работаем с самим файлом через pdf-lib: JPEG внутри PDF — это обычный JPEG, его отдаём
// как есть, без потерь; несжатые картинки (Flate) распаковываем сами.
const zlib = require('zlib')
const { PDFName, PDFDict, PDFArray, PDFRawStream, PDFRef, PDFNumber } = require('pdf-lib')

const name = (v) => (v instanceof PDFName ? v.decodeText() : null)

// Фильтры потока одним списком: /Filter бывает и именем, и массивом
function filters(dict) {
  const f = dict.lookup(PDFName.of('Filter'))
  if (!f) return []
  if (f instanceof PDFArray) return f.asArray().map((x) => name(dict.context.lookup(x)))
  return [name(f)]
}

// Цветовое пространство → сколько каналов и есть ли палитра
function colorSpace(dict) {
  let cs = dict.lookup(PDFName.of('ColorSpace'))
  if (cs instanceof PDFName) {
    const n = name(cs)
    return { DeviceRGB: { channels: 3 }, DeviceGray: { channels: 1 }, CalRGB: { channels: 3 }, CalGray: { channels: 1 } }[n] ?? null
  }
  if (cs instanceof PDFArray) {
    const kind = name(dict.context.lookup(cs.get(0)))
    if (kind === 'ICCBased') {
      const icc = dict.context.lookup(cs.get(1))
      const n = icc?.dict?.lookup(PDFName.of('N'))?.asNumber?.()
      return n === 3 || n === 1 ? { channels: n } : null
    }
    if (kind === 'CalRGB') return { channels: 3 }
    if (kind === 'CalGray') return { channels: 1 }
    if (kind === 'Indexed') {
      // [/Indexed база hival таблица]: каждая точка — номер цвета в таблице
      const base = dict.context.lookup(cs.get(1))
      const baseName = base instanceof PDFName ? name(base) : base instanceof PDFArray && name(dict.context.lookup(base.get(0)))
      const baseChannels = baseName === 'DeviceRGB' || baseName === 'CalRGB' ? 3 : baseName === 'DeviceGray' || baseName === 'CalGray' ? 1 : baseName === 'ICCBased' ? dict.context.lookup(base.get(1))?.dict?.lookup(PDFName.of('N'))?.asNumber?.() : 0
      if (baseChannels !== 3 && baseChannels !== 1) return null
      const lookup = dict.context.lookup(cs.get(3))
      let table
      if (lookup instanceof PDFRawStream) table = decodeStream(lookup)
      else if (lookup?.asBytes) table = lookup.asBytes()
      if (!table) return null
      return { channels: baseChannels, palette: Buffer.from(table) }
    }
  }
  return null
}

// PNG-предсказатели (Predictor 10–15) — так картинки в PDF часто сжимают лучше
function unpredict(data, columns, colors, bpc) {
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8))
  const row = Math.ceil((columns * colors * bpc) / 8)
  const rows = Math.floor(data.length / (row + 1))
  const out = Buffer.alloc(rows * row)
  for (let y = 0; y < rows; y++) {
    const type = data[y * (row + 1)]
    const src = y * (row + 1) + 1
    const dst = y * row
    for (let x = 0; x < row; x++) {
      const left = x >= bpp ? out[dst + x - bpp] : 0
      const up = y ? out[dst - row + x] : 0
      const upLeft = y && x >= bpp ? out[dst - row + x - bpp] : 0
      let v = data[src + x]
      if (type === 1) v += left
      else if (type === 2) v += up
      else if (type === 3) v += (left + up) >> 1
      else if (type === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        v += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      out[dst + x] = v & 0xff
    }
  }
  return out
}

// Распаковать поток, если сжат только Flate (или ничем)
function decodeStream(stream) {
  const f = filters(stream.dict)
  if (f.length > 1 || (f.length === 1 && f[0] !== 'FlateDecode')) return null
  let data = Buffer.from(stream.getContents())
  if (f[0] === 'FlateDecode') {
    try {
      data = zlib.inflateSync(data)
    } catch {
      return null
    }
    const parms = stream.dict.lookup(PDFName.of('DecodeParms'))
    const predictor = parms instanceof PDFDict ? parms.lookup(PDFName.of('Predictor'))?.asNumber?.() ?? 1 : 1
    if (predictor >= 10) {
      const num = (k, d) => parms.lookup(PDFName.of(k))?.asNumber?.() ?? d
      data = unpredict(data, num('Columns', 1), num('Colors', 1), num('BitsPerComponent', 8))
    } else if (predictor !== 1) return null
  }
  return data
}

const num = (dict, key) => dict.lookup(PDFName.of(key))?.asNumber?.()

// Картинка из потока: { jpeg } — как есть, или { data, width, height, channels } — пиксели.
// null — формат нам не по зубам (CCITT, JBIG2, JPEG 2000, CMYK…)
function readImage(stream) {
  const dict = stream.dict
  const width = num(dict, 'Width')
  const height = num(dict, 'Height')
  if (!width || !height || dict.lookup(PDFName.of('ImageMask'))?.asBoolean?.()) return null
  const f = filters(dict)
  const cs = colorSpace(dict)
  if (f.length === 1 && f[0] === 'DCTDecode') {
    // CMYK-JPEG из PDF обычно «вывернут» (Adobe) — такие не трогаем
    if (!cs || cs.palette) return null
    return { jpeg: Buffer.from(stream.getContents()), width, height, channels: cs.channels }
  }
  if (!cs || dict.lookup(PDFName.of('Decode'))) return null
  const bpc = num(dict, 'BitsPerComponent') ?? 8
  const raw = decodeStream(stream)
  if (!raw) return null
  // Привести к 8 битам на канал
  const per = cs.palette ? 1 : cs.channels
  const rowBytes = Math.ceil((width * per * bpc) / 8)
  if (raw.length < rowBytes * height) return null
  const channels = cs.channels
  const out = Buffer.alloc(width * height * channels)
  const max = (1 << bpc) - 1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < per; c++) {
        const bit = (x * per + c) * bpc
        let v
        if (bpc === 8) v = raw[y * rowBytes + x * per + c]
        else if (bpc === 16) v = raw[y * rowBytes + (x * per + c) * 2]
        else v = (raw[y * rowBytes + (bit >> 3)] >> (8 - bpc - (bit & 7))) & max
        if (cs.palette) {
          for (let k = 0; k < channels; k++) out[(y * width + x) * channels + k] = cs.palette[v * channels + k] ?? 0
        } else out[(y * width + x) * channels + c] = bpc === 8 || bpc === 16 ? v : Math.round((v * 255) / max)
      }
  // Прозрачность хранится отдельной серой картинкой /SMask — добавим альфа-канал, если размеры совпадают
  const smask = dict.lookup(PDFName.of('SMask'))
  if (smask instanceof PDFRawStream && num(smask.dict, 'Width') === width && num(smask.dict, 'Height') === height && (num(smask.dict, 'BitsPerComponent') ?? 8) === 8) {
    const alpha = decodeStream(smask)
    if (alpha && alpha.length >= width * height) {
      const rgba = Buffer.alloc(width * height * 4)
      for (let i = 0; i < width * height; i++) {
        for (let k = 0; k < 3; k++) rgba[i * 4 + k] = out[i * channels + (channels === 3 ? k : 0)]
        rgba[i * 4 + 3] = alpha[i]
      }
      return { data: rgba, width, height, channels: 4 }
    }
  }
  return { data: out, width, height, channels }
}

// Все картинки по страницам: [{ page, ref, stream }], каждая — один раз.
// Заходим и во вложенные «формы» (Form XObject) — там картинки тоже бывают
function imagesByPage(doc) {
  const seen = new Set()
  const list = []
  const walk = (resources, page, depth) => {
    if (!(resources instanceof PDFDict) || depth > 8) return
    const xobjects = resources.lookup(PDFName.of('XObject'))
    if (!(xobjects instanceof PDFDict)) return
    for (const [, value] of xobjects.entries()) {
      const ref = value instanceof PDFRef ? value : null
      const obj = doc.context.lookup(value)
      if (!(obj instanceof PDFRawStream) || (ref && seen.has(ref.toString()))) continue
      if (ref) seen.add(ref.toString())
      const subtype = name(obj.dict.lookup(PDFName.of('Subtype')))
      if (subtype === 'Image') list.push({ page, ref, stream: obj })
      else if (subtype === 'Form') walk(obj.dict.lookup(PDFName.of('Resources')), page, depth + 1)
    }
  }
  doc.getPages().forEach((p, i) => walk(p.node.Resources(), i + 1, 0))
  return list
}

// ---------- Сжать PDF ----------
// Крупные картинки пережимаем в JPEG (не больше maxSide точек по длинной стороне),
// несжатые служебные потоки сжимаем, а при сохранении pdf-lib упакует объекты в потоки.
// encodeJpeg(image, { maxSide, quality }) → { data, width, height } — делает рабочее окно
async function compressPdf(doc, encodeJpeg, { maxSide = 1600, quality = 0.7 } = {}) {
  let replaced = 0
  for (const { ref, stream } of imagesByPage(doc)) {
    if (!ref) continue
    const width = num(stream.dict, 'Width')
    const height = num(stream.dict, 'Height')
    if (width * height < 160000) continue // мелочь не трогаем
    const image = readImage(stream)
    if (!image || image.channels === 4) continue // прозрачность в JPEG не влезет
    let res
    try {
      res = await encodeJpeg(image, { maxSide, quality })
    } catch {
      continue
    }
    if (res.data.length >= stream.getContents().length * 0.9) continue // выигрыш копеечный
    const dict = stream.dict.clone(doc.context)
    dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'))
    dict.set(PDFName.of('Width'), PDFNumber.of(res.width))
    dict.set(PDFName.of('Height'), PDFNumber.of(res.height))
    dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'))
    dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8))
    dict.delete(PDFName.of('DecodeParms'))
    dict.delete(PDFName.of('Decode'))
    doc.context.assign(ref, PDFRawStream.of(dict, res.data))
    replaced++
  }
  // Несжатые потоки (часто — текст страниц) сжимаем Flate без потерь
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.has(PDFName.of('Filter')) || obj.getContents().length < 512) continue
    const packed = zlib.deflateSync(Buffer.from(obj.getContents()), { level: 9 })
    if (packed.length >= obj.getContents().length) continue
    obj.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))
    doc.context.assign(ref, PDFRawStream.of(obj.dict, packed))
  }
  return replaced
}

module.exports = { readImage, imagesByPage, compressPdf }
