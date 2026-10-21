// Папка Familiar (%USERPROFILE%\Familiar) и работа с файлами для «Ярлыков» и «Файлов».
// Перемещать, переименовывать и удалять сами файлы — дело Проводника; мы только
// показываем, открываем и создаём/убираем ярлыки.
const path = require('path')
const fs = require('fs')
const { shell } = require('electron')

const isWin = process.platform === 'win32'

const familiarDir = (app) => path.join(app.getPath('home'), 'Familiar')

const README = `Это папка Familiar.

Всё, что лежит здесь, показывается в виджете «Ярлыки» и ищется по Alt+Space.
Перетащи файл или папку на виджет «Ярлыки» — здесь появится ярлык,
а оригинал останется на своём месте. Убрать ярлык = удалить только ярлык.
`

function ensureFamiliarDir(app) {
  const dir = familiarDir(app)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'Прочитай меня.txt'), README)
  }
  return dir
}

// Быстрые места для боковой панели «Файлов»
function places(app) {
  const p = (name) => {
    try {
      return app.getPath(name)
    } catch {
      return null
    }
  }
  return [
    { name: 'Familiar', path: familiarDir(app) },
    { name: 'Рабочий стол', path: p('desktop') },
    { name: 'Документы', path: p('documents') },
    { name: 'Загрузки', path: p('downloads') },
    { name: 'Изображения', path: p('pictures') },
    { name: 'Музыка', path: p('music') },
    { name: 'Видео', path: p('videos') },
    { name: 'Домашняя папка', path: p('home') }
  ].filter((x) => x.path && fs.existsSync(x.path))
}

const HIDDEN = /^(\.|desktop\.ini$|thumbs\.db$|\$recycle\.bin$)/i

// Содержимое папки: сначала папки, потом файлы, по алфавиту
function listFolder(dir, limit = 1000) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return { path: dir, entries: [], error: 'Нет доступа к папке' }
  }
  const out = []
  for (const e of entries) {
    if (HIDDEN.test(e.name)) continue
    const full = path.join(dir, e.name)
    let stat = null
    try {
      stat = fs.statSync(full) // следует по ссылкам: ссылка на папку — тоже папка
    } catch {
      // битая ссылка — покажем как файл
    }
    const isLink = isWin ? /\.lnk$/i.test(e.name) : e.isSymbolicLink()
    out.push({
      name: isWin ? e.name.replace(/\.lnk$/i, '') : e.name,
      path: full,
      isDir: !!stat?.isDirectory() || (isLink && isDirTarget(full)),
      isLink,
      size: stat?.isFile() ? stat.size : null,
      modified: stat?.mtimeMs ?? null
    })
    if (out.length >= limit) break
  }
  out.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'ru') : a.isDir ? -1 : 1))
  return { path: dir, parent: path.dirname(dir) !== dir ? path.dirname(dir) : null, entries: out }
}

// Куда ведёт ярлык .lnk (только Windows)
function linkTarget(p) {
  if (!isWin || !/\.lnk$/i.test(p)) return p
  try {
    return shell.readShortcutLink(p).target || p
  } catch {
    return p
  }
}

function isDirTarget(p) {
  try {
    return fs.statSync(linkTarget(p)).isDirectory()
  } catch {
    return false
  }
}

function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, base + ext)
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`)
  return candidate
}

// Перетащили файл на «Ярлыки» — кладём в папку Familiar ярлык на него
function addShortcut(app, target) {
  const dir = ensureFamiliarDir(app)
  if (path.dirname(target) === dir) return null // уже лежит здесь
  if (isWin) {
    if (/\.lnk$/i.test(target)) {
      const dest = uniquePath(dir, path.basename(target, '.lnk'), '.lnk')
      fs.copyFileSync(target, dest)
      return dest
    }
    const dest = uniquePath(dir, path.parse(target).name || path.basename(target), '.lnk')
    shell.writeShortcutLink(dest, 'create', { target })
    return dest
  }
  const dest = uniquePath(dir, path.basename(target), '')
  fs.symlinkSync(target, dest)
  return dest
}

// Убрать из папки Familiar. Ярлык удаляем — оригинал остаётся;
// настоящий файл не удаляем насовсем, а отправляем в корзину
async function removeFromFamiliar(app, p) {
  const dir = familiarDir(app)
  if (path.dirname(path.resolve(p)) !== dir) throw new Error('Убирать можно только то, что лежит в папке Familiar')
  const isLink = isWin ? /\.lnk$/i.test(p) : fs.lstatSync(p).isSymbolicLink()
  if (isLink) fs.unlinkSync(p)
  else await shell.trashItem(p)
}

// Для Alt+Space: всё внутри папки Familiar (до 3 уровней вложенности)
function searchFamiliar(app, depth = 3) {
  const out = []
  const walk = (dir, d) => {
    if (d > depth || out.length > 2000) return
    for (const e of listFolder(dir).entries) {
      out.push({ name: e.name, path: e.path, isFile: true })
      if (e.isDir && !e.isLink) walk(e.path, d + 1)
    }
  }
  walk(familiarDir(app), 0)
  return out
}

module.exports = { familiarDir, ensureFamiliarDir, places, listFolder, linkTarget, isDirTarget, addShortcut, removeFromFamiliar, searchFamiliar }
