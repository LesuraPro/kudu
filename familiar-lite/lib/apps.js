// Поиск установленных приложений и файлов для Alt+Space
const path = require('path')
const fs = require('fs')

const isWin = process.platform === 'win32'

function walk(dir, exts, out = [], depth = 0) {
  if (depth > 4) return out
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, exts, out, depth + 1)
    else if (exts.includes(path.extname(e.name).toLowerCase())) out.push(full)
  }
  return out
}

// Linux: файлы .desktop — только чтобы прототип можно было проверить не на винде
function parseDesktopFile(file) {
  const text = fs.readFileSync(file, 'utf8')
  const section = text.split(/^\[/m).find((s) => s.startsWith('Desktop Entry]'))
  if (!section || /^NoDisplay=true/m.test(section)) return null
  const name = section.match(/^Name=(.*)$/m)?.[1]
  const exec = section.match(/^Exec=(.*)$/m)?.[1]
  if (!name || !exec) return null
  return { name, path: file, exec: exec.replace(/%[a-zA-Z]/g, '').trim() }
}

let cache = null

// Windows: ярлыки .lnk из меню «Пуск» (общего и пользовательского) и с рабочего стола
function listApps(app) {
  if (cache) return cache
  let apps
  if (isWin) {
    const dirs = [
      path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
      path.join(app.getPath('appData'), 'Microsoft\\Windows\\Start Menu\\Programs'),
      app.getPath('desktop')
    ]
    apps = dirs
      .flatMap((d) => walk(d, ['.lnk', '.url', '.exe']))
      .map((p) => ({ name: path.basename(p, path.extname(p)), path: p }))
      .filter((a) => !/uninstall|удал/i.test(a.name))
  } else {
    apps = walk('/usr/share/applications', ['.desktop'])
      .map((p) => {
        try {
          return parseDesktopFile(p)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  }
  // Убираем дубли по имени и сортируем
  const seen = new Set()
  cache = apps
    .filter((a) => !seen.has(a.name.toLowerCase()) && seen.add(a.name.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
  return cache
}

// Файлы с рабочего стола и из «Документов» тоже ищутся по Alt+Space
function listFiles(app) {
  return [app.getPath('desktop'), app.getPath('documents')]
    .flatMap((d) => {
      try {
        return fs.readdirSync(d, { withFileTypes: true }).map((e) => ({ name: e.name, path: path.join(d, e.name), isFile: true }))
      } catch {
        return []
      }
    })
    .filter((f) => !f.name.startsWith('.') && !/\.(lnk|url|ini)$/i.test(f.name))
}

module.exports = { listApps, listFiles }
