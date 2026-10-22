// Пароль на PDF: шифрование AES-256 (стандарт PDF 2.0, «Revision 6») — как у оригинала DragShift.
// pdf-lib шифровать не умеет, поэтому делаем сами: шифруем каждую строку и каждый поток
// документа ключом файла, а в словарь /Encrypt кладём всё, чтобы читалка проверила пароль.
// Открыть такой файл можно в любой современной программе: Acrobat, браузеры, «Яндекс», Word.
const crypto = require('crypto')
const { PDFDocument, PDFName, PDFNumber, PDFHexString, PDFString, PDFDict, PDFArray, PDFStream, PDFRawStream, PDFBool } = require('pdf-lib')

// Разрешения: печать, копирование и чтение с экрана — как у оригинала
// (биты 3, 5, 10, 12; биты 7–8 и с 13-го и выше по стандарту — единицы)
const PERMISSIONS = (0xfffff000 | 0xc0 | 4 | 16 | 512 | 2048) | 0

const aes = (mode, key, iv, data, padding) => {
  const c = crypto.createCipheriv(mode, key, iv)
  c.setAutoPadding(padding)
  return Buffer.concat([c.update(data), c.final()])
}

// Хэш из стандарта (алгоритм 2.B): SHA-256/384/512 вперемешку минимум 64 раунда —
// чтобы перебор паролей был медленным
function hash(password, salt, udata = Buffer.alloc(0)) {
  let k = crypto.createHash('sha256').update(Buffer.concat([password, salt, udata])).digest()
  for (let i = 0; ; i++) {
    const k1 = Buffer.concat(Array(64).fill(Buffer.concat([password, k, udata])))
    const e = aes('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32), k1, false)
    // Сумма первых 16 байт по модулю 3 — то же, что большое число по модулю 3
    let mod = 0
    for (let j = 0; j < 16; j++) mod += e[j]
    k = crypto.createHash(['sha256', 'sha384', 'sha512'][mod % 3]).update(e).digest()
    if (i >= 63 && e[e.length - 1] <= i - 32) break
  }
  return k.subarray(0, 32)
}

function encryptionDict(passwordText, fileKey) {
  const password = Buffer.from(passwordText.normalize('NFKC'), 'utf8').subarray(0, 127)
  const zeroIv = Buffer.alloc(16)
  // Пароль пользователя
  const uSalt = crypto.randomBytes(16) // 8 байт для проверки, 8 — для ключа
  const U = Buffer.concat([hash(password, uSalt.subarray(0, 8)), uSalt])
  const UE = aes('aes-256-cbc', hash(password, uSalt.subarray(8)), zeroIv, fileKey, false)
  // Пароль владельца — тот же (как у оригинала): кто знает пароль, тому можно всё
  const oSalt = crypto.randomBytes(16)
  const O = Buffer.concat([hash(password, oSalt.subarray(0, 8), U), oSalt])
  const OE = aes('aes-256-cbc', hash(password, oSalt.subarray(8), U), zeroIv, fileKey, false)
  // Perms — разрешения, зашифрованные ключом файла (защита от подмены /P)
  const perms = Buffer.alloc(16)
  perms.writeInt32LE(PERMISSIONS, 0)
  perms.writeUInt32LE(0xffffffff, 4)
  perms.write('Tadb', 8, 'latin1') // T — метаданные тоже зашифрованы
  crypto.randomBytes(4).copy(perms, 12)
  const Perms = aes('aes-256-ecb', fileKey, null, perms, false)
  return { O, U, OE, UE, Perms }
}

// Строку или поток — AES-256-CBC: случайный вектор впереди, дополнение PKCS#7
const encryptBytes = (key, bytes) => {
  const iv = crypto.randomBytes(16)
  return Buffer.concat([iv, aes('aes-256-cbc', key, iv, bytes, true)])
}

const hex = (bytes) => PDFHexString.of(Buffer.from(bytes).toString('hex'))

// Пройти по объекту и зашифровать все строки внутри (словари и массивы — вглубь)
function encryptStrings(obj, key) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return hex(encryptBytes(key, obj.asBytes()))
  if (obj instanceof PDFDict) {
    for (const [name, value] of obj.entries()) {
      const next = encryptStrings(value, key)
      if (next !== value) obj.set(name, next)
    }
  } else if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      const value = obj.get(i)
      const next = encryptStrings(value, key)
      if (next !== value) obj.set(i, next)
    }
  }
  return obj
}

async function protectPdf(bytes, password) {
  if (!password) throw new Error('Пустой пароль')
  let doc
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false })
  } catch (err) {
    if (/encrypt/i.test(err.message)) throw new Error('Этот PDF уже защищён паролем')
    throw err
  }
  const ctx = doc.context
  const fileKey = crypto.randomBytes(32)
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) {
      encryptStrings(obj.dict, fileKey)
      // getContents() — байты потока в том виде, как они лежат в файле (уже сжатые)
      ctx.assign(ref, PDFRawStream.of(obj.dict, encryptBytes(fileKey, obj.getContents())))
    } else {
      const next = encryptStrings(obj, fileKey)
      if (next !== obj) ctx.assign(ref, next)
    }
  }
  const { O, U, OE, UE, Perms } = encryptionDict(password, fileKey)
  const encrypt = ctx.obj({
    Filter: 'Standard',
    V: 5,
    R: 6,
    Length: 256,
    CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } },
    StmF: 'StdCF',
    StrF: 'StdCF',
    P: PDFNumber.of(PERMISSIONS),
    EncryptMetadata: PDFBool.True
  })
  encrypt.set(PDFName.of('O'), hex(O))
  encrypt.set(PDFName.of('U'), hex(U))
  encrypt.set(PDFName.of('OE'), hex(OE))
  encrypt.set(PDFName.of('UE'), hex(UE))
  encrypt.set(PDFName.of('Perms'), hex(Perms))
  ctx.trailerInfo.Encrypt = ctx.register(encrypt)
  const id = hex(crypto.randomBytes(16))
  ctx.trailerInfo.ID = ctx.obj([id, id])
  // Без «потоков объектов»: иначе строки внутри них оказались бы зашифрованы дважды
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false })
}

module.exports = { protectPdf }
