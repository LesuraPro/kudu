// Метаданные картинок: что внутри (камера, геолокация, поворот) и как их убрать
// БЕЗ пересжатия — вырезаем служебные блоки прямо из файла, пиксели не трогаем.

// ---------- EXIF (внутри JPEG APP1 или чанка WebP «EXIF») ----------

const TAGS = { 0x010f: 'make', 0x0110: 'model', 0x0112: 'orientation', 0x8825: 'gps', 0x9003: 'date' }

// tiff — байты, начиная с заголовка «II*\0» / «MM\0*»
function parseTiff(tiff) {
  const info = {}
  if (tiff.length < 8) return info
  const le = tiff[0] === 0x49 // 'I' — little-endian
  const u16 = (o) => (le ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1])
  const u32 = (o) => (le ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16)) + tiff[o + 3] * 2 ** 24 : tiff[o] * 2 ** 24 + ((tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3]))
  const ascii = (o, n) => String.fromCharCode(...tiff.subarray(o, o + n)).replace(/\0.*$/s, '').trim()

  const readIfd = (offset) => {
    if (offset + 2 > tiff.length) return
    const count = u16(offset)
    for (let i = 0; i < count; i++) {
      const e = offset + 2 + i * 12
      if (e + 12 > tiff.length) return
      const tag = u16(e)
      const name = TAGS[tag]
      const type = u16(e + 2)
      const n = u32(e + 4)
      if (tag === 0x8769) readIfd(u32(e + 8)) // Exif SubIFD — там дата съёмки
      if (!name) continue
      if (name === 'orientation') info.orientation = u16(e + 8)
      else if (name === 'gps') info.gps = true
      else if (type === 2) info[name] = ascii(n <= 4 ? e + 8 : u32(e + 8), n)
    }
  }
  readIfd(u32(4))
  return info
}

// ---------- JPEG ----------

function jpegSegments(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null
  const segs = []
  let o = 2
  while (o + 4 <= buf.length) {
    if (buf[o] !== 0xff) return null
    const marker = buf[o + 1]
    if (marker === 0xda) return { segs, rest: o } // начало сжатых данных — дальше копируем как есть
    const len = (buf[o + 2] << 8) | buf[o + 3]
    segs.push({ marker, start: o, end: o + 2 + len })
    o += 2 + len
  }
  return null
}

const isExifApp1 = (buf, s) => buf.toString('latin1', s.start + 4, s.start + 10) === 'Exif\0\0'

// ---------- PNG ----------

function pngChunks(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null
  const chunks = []
  let o = 8
  while (o + 12 <= buf.length) {
    const len = buf.readUInt32BE(o)
    const type = buf.toString('latin1', o + 4, o + 8)
    chunks.push({ type, start: o, end: o + 12 + len })
    o += 12 + len
  }
  return chunks
}

// ---------- WebP (RIFF) ----------

function webpChunks(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null
  const chunks = []
  let o = 12
  while (o + 8 <= buf.length) {
    const type = buf.toString('latin1', o, o + 4)
    const len = buf.readUInt32LE(o + 4)
    const end = o + 8 + len + (len % 2) // чанки выровнены по 2 байта
    chunks.push({ type, start: o, end: Math.min(end, buf.length) })
    o = end
  }
  return chunks
}

// ---------- Что внутри ----------

function readMeta(buf) {
  const jpeg = jpegSegments(buf)
  if (jpeg) {
    const app1 = jpeg.segs.find((s) => s.marker === 0xe1 && isExifApp1(buf, s))
    const info = app1 ? parseTiff(buf.subarray(app1.start + 10, app1.end)) : {}
    info.hasMeta = jpeg.segs.some((s) => [0xe1, 0xed, 0xfe].includes(s.marker))
    return info
  }
  const png = pngChunks(buf)
  if (png) {
    const exif = png.find((c) => c.type === 'eXIf')
    const info = exif ? parseTiff(buf.subarray(exif.start + 8, exif.end - 4)) : {}
    info.hasMeta = png.some((c) => STRIP_PNG.has(c.type))
    return info
  }
  const webp = webpChunks(buf)
  if (webp) {
    const exif = webp.find((c) => c.type === 'EXIF')
    let tiff = exif ? buf.subarray(exif.start + 8, exif.end) : null
    if (tiff && tiff.toString('latin1', 0, 6) === 'Exif\0\0') tiff = tiff.subarray(6)
    const info = tiff ? parseTiff(tiff) : {}
    info.hasMeta = webp.some((c) => c.type === 'EXIF' || c.type === 'XMP ')
    return info
  }
  return { hasMeta: false, unknown: true }
}

// ---------- Убрать метаданные без пересжатия ----------

const STRIP_PNG = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'])

// null — формат не поддерживается без перекодирования (или снимок повёрнут через EXIF)
function stripMeta(buf) {
  const jpeg = jpegSegments(buf)
  if (jpeg) {
    // Поворот хранится в EXIF: если его вырезать, фото ляжет набок — такой снимок надо перекодировать
    const app1 = jpeg.segs.find((s) => s.marker === 0xe1 && isExifApp1(buf, s))
    const orientation = app1 ? parseTiff(buf.subarray(app1.start + 10, app1.end)).orientation : 1
    if (orientation && orientation !== 1) return null
    // Убираем APP1 (EXIF, XMP), APP13 (IPTC) и комментарии; JFIF, ICC-профиль и Adobe — оставляем
    const keep = jpeg.segs.filter((s) => ![0xe1, 0xed, 0xfe].includes(s.marker))
    return Buffer.concat([buf.subarray(0, 2), ...keep.map((s) => buf.subarray(s.start, s.end)), buf.subarray(jpeg.rest)])
  }
  const png = pngChunks(buf)
  if (png) {
    return Buffer.concat([buf.subarray(0, 8), ...png.filter((c) => !STRIP_PNG.has(c.type)).map((c) => buf.subarray(c.start, c.end))])
  }
  const webp = webpChunks(buf)
  if (webp) {
    const parts = webp
      .filter((c) => c.type !== 'EXIF' && c.type !== 'XMP ')
      .map((c) => {
        const chunk = Buffer.from(buf.subarray(c.start, c.end))
        // В заголовке VP8X флаги «есть EXIF» (бит 3) и «есть XMP» (бит 2) — снимаем
        if (c.type === 'VP8X') chunk[8] &= ~0b1100
        return chunk
      })
    const body = Buffer.concat(parts)
    const header = Buffer.alloc(12)
    header.write('RIFF', 0, 'latin1')
    header.writeUInt32LE(body.length + 4, 4)
    header.write('WEBP', 8, 'latin1')
    return Buffer.concat([header, body])
  }
  return null
}

module.exports = { readMeta, stripMeta }
