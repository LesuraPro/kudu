// Метаданные картинок: что внутри (камера, геолокация, поворот) и как их убрать
// БЕЗ пересжатия — вырезаем служебные блоки прямо из файла, пиксели не трогаем.

// ---------- EXIF (внутри JPEG APP1 или чанка WebP «EXIF») ----------

const TAGS = {
  0x010f: 'make', 0x0110: 'model', 0x0112: 'orientation', 0x0131: 'software', 0x0132: 'modified',
  0x9003: 'date', 0x829a: 'exposure', 0x829d: 'aperture', 0x8827: 'iso', 0xa434: 'lens'
}

// tiff — байты, начиная с заголовка «II*\0» / «MM\0*»
function parseTiff(tiff) {
  const info = { tags: 0 }
  if (tiff.length < 8) return info
  const le = tiff[0] === 0x49 // 'I' — little-endian
  const u16 = (o) => (le ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1])
  const u32 = (o) => (le ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16)) + tiff[o + 3] * 2 ** 24 : tiff[o] * 2 ** 24 + ((tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3]))
  const ascii = (o, n) => String.fromCharCode(...tiff.subarray(o, o + n)).replace(/\0.*$/s, '').trim()
  const rational = (o) => (u32(o + 4) ? u32(o) / u32(o + 4) : 0)
  const seen = new Set() // защита от зацикленных ссылок в битых файлах

  const readGps = (offset) => {
    if (offset + 2 > tiff.length) return
    info.gpsIfd = offset
    const count = u16(offset)
    const gps = {}
    for (let i = 0; i < count; i++) {
      const e = offset + 2 + i * 12
      if (e + 12 > tiff.length) break
      const tag = u16(e)
      if (tag === 1 || tag === 3) gps[tag] = String.fromCharCode(tiff[e + 8])
      if ((tag === 2 || tag === 4) && u32(e + 4) === 3) {
        const at = u32(e + 8)
        if (at + 24 <= tiff.length) gps[tag] = rational(at) + rational(at + 8) / 60 + rational(at + 16) / 3600
      }
    }
    info.tags += count
    if (count) info.gps = true
    if (gps[2] != null && gps[4] != null) info.location = [gps[1] === 'S' ? -gps[2] : gps[2], gps[3] === 'W' ? -gps[4] : gps[4]]
  }

  const readIfd = (offset) => {
    if (offset + 2 > tiff.length || seen.has(offset)) return
    seen.add(offset)
    const count = u16(offset)
    info.tags += count
    for (let i = 0; i < count; i++) {
      const e = offset + 2 + i * 12
      if (e + 12 > tiff.length) return
      const tag = u16(e)
      const name = TAGS[tag]
      const type = u16(e + 2)
      const n = u32(e + 4)
      if (tag === 0x8769) readIfd(u32(e + 8)) // Exif SubIFD — там дата съёмки и настройки камеры
      if (tag === 0x8825) readGps(u32(e + 8))
      if (!name) continue
      // Числа бывают разных типов: 3 — SHORT, 4 — LONG, 5 — дробь, 12 — DOUBLE
      if (type === 3) info[name] = u16(e + 8)
      else if (type === 4) info[name] = u32(e + 8)
      else if (type === 5 && u32(e + 8) + 8 <= tiff.length) info[name] = rational(u32(e + 8))
      else if (type === 12 && u32(e + 8) + 8 <= tiff.length) info[name] = Buffer.from(tiff.subarray(u32(e + 8), u32(e + 8) + 8))[le ? 'readDoubleLE' : 'readDoubleBE'](0)
      else if (type === 2) info[name] = ascii(n <= 4 ? e + 8 : u32(e + 8), n)
    }
  }
  readIfd(u32(4))
  return info
}

// Затереть геолокацию прямо в байтах EXIF: обнуляем записи GPS и их данные.
// Длина не меняется, смещения остальных тегов остаются верными — остальное не трогаем
function wipeGps(tiff) {
  const info = parseTiff(tiff)
  if (info.gpsIfd == null) return false
  const le = tiff[0] === 0x49
  const u16 = (o) => (le ? tiff[o] | (tiff[o + 1] << 8) : (tiff[o] << 8) | tiff[o + 1])
  const u32 = (o) => (le ? (tiff[o] | (tiff[o + 1] << 8) | (tiff[o + 2] << 16)) + tiff[o + 3] * 2 ** 24 : tiff[o] * 2 ** 24 + ((tiff[o + 1] << 16) | (tiff[o + 2] << 8) | tiff[o + 3]))
  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }
  const start = info.gpsIfd
  const count = u16(start)
  for (let i = 0; i < count; i++) {
    const e = start + 2 + i * 12
    if (e + 12 > tiff.length) break
    const bytes = (SIZE[u16(e + 2)] ?? 1) * u32(e + 4)
    if (bytes > 4) {
      const at = u32(e + 8)
      if (at + bytes <= tiff.length) tiff.fill(0, at, at + bytes)
    }
    tiff.fill(0, e, e + 12)
  }
  // Ноль записей в GPS-каталоге — для читалок геолокации просто нет
  tiff[start] = 0
  tiff[start + 1] = 0
  return true
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

// ---------- Убрать только геолокацию ----------
// Камера, дата и поворот остаются; сами пиксели — байт в байт. null — геолокации нет

function stripLocation(input) {
  const buf = Buffer.from(input) // копия: оригинал не трогаем
  const jpeg = jpegSegments(buf)
  if (jpeg) {
    const app1 = jpeg.segs.find((s) => s.marker === 0xe1 && isExifApp1(buf, s))
    return app1 && wipeGps(buf.subarray(app1.start + 10, app1.end)) ? buf : null
  }
  const png = pngChunks(buf)
  if (png) {
    const exif = png.find((c) => c.type === 'eXIf')
    if (!exif || !wipeGps(buf.subarray(exif.start + 8, exif.end - 4))) return null
    // У чанка PNG своя контрольная сумма — пересчитываем
    buf.writeUInt32BE(crc32(buf.subarray(exif.start + 4, exif.end - 4)), exif.end - 4)
    return buf
  }
  const webp = webpChunks(buf)
  if (webp) {
    const exif = webp.find((c) => c.type === 'EXIF')
    if (!exif) return null
    let tiff = buf.subarray(exif.start + 8, exif.end)
    if (tiff.toString('latin1', 0, 6) === 'Exif\0\0') tiff = tiff.subarray(6)
    return wipeGps(tiff) ? buf : null
  }
  return null
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(bytes) {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

module.exports = { readMeta, stripMeta, stripLocation }
