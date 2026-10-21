// Библиотека игр: Steam и Epic Games. Только чтение файлов лаунчеров, без их API.
const path = require('path')
const fs = require('fs')
const { execFileSync } = require('child_process')

const isWin = process.platform === 'win32'

const read = (p) => {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

function steamRoot() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {
      encoding: 'utf8',
      windowsHide: true
    })
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/)
    if (m) return path.normalize(m[1].trim())
  } catch {
    // Steam не установлен или реестр недоступен
  }
  return 'C:\\Program Files (x86)\\Steam'
}

// Не игры, а служебные пакеты Steam
const STEAM_JUNK = /redist|proton|runtime|steamworks|soundtrack|dedicated server|benchmark/i

function steamGames() {
  const root = steamRoot()
  const vdf = read(path.join(root, 'steamapps', 'libraryfolders.vdf'))
  // В libraryfolders.vdf лежат пути ко всем библиотекам (на других дисках тоже)
  const libs = new Set([root])
  for (const m of (vdf ?? '').matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'))

  const games = []
  for (const lib of libs) {
    let files = []
    try {
      files = fs.readdirSync(path.join(lib, 'steamapps')).filter((f) => /^appmanifest_\d+\.acf$/.test(f))
    } catch {
      continue
    }
    for (const f of files) {
      const acf = read(path.join(lib, 'steamapps', f)) ?? ''
      const id = acf.match(/"appid"\s+"(\d+)"/)?.[1]
      const name = acf.match(/"name"\s+"([^"]+)"/)?.[1]
      if (!id || !name || id === '228980' || STEAM_JUNK.test(name)) continue
      games.push({ id: `steam:${id}`, name, store: 'Steam', path: `steam://rungameid/${id}`, steamId: id })
    }
  }
  return { games, root }
}

function epicGames() {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests')
  let files = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.item'))
  } catch {
    return []
  }
  const games = []
  for (const f of files) {
    try {
      const m = JSON.parse(read(path.join(dir, f)))
      if (m.bIsIncompleteInstall || !m.DisplayName) continue
      const id = `${m.CatalogNamespace}%3A${m.CatalogItemId}%3A${m.AppName}`
      games.push({
        id: `epic:${m.AppName}`,
        name: m.DisplayName,
        store: 'Epic',
        path: `com.epicgames.launcher://apps/${id}?action=launch&silent=true`
      })
    } catch {
      // битый манифест — пропускаем
    }
  }
  return games
}

let cache = null
let steamDir = null

function listGames(isDemo) {
  if (isDemo) {
    return [
      { id: 'demo:cs2', name: 'Counter-Strike 2', store: 'Steam', path: 'steam://rungameid/730' },
      { id: 'demo:dota', name: 'Dota 2', store: 'Steam', path: 'steam://rungameid/570' },
      { id: 'demo:fn', name: 'Fortnite', store: 'Epic', path: 'com.epicgames.launcher://apps/fn' },
      { id: 'demo:stalker', name: 'S.T.A.L.K.E.R. 2', store: 'Steam', path: 'steam://rungameid/1643320' }
    ]
  }
  if (!isWin) return []
  if (cache) return cache
  const steam = steamGames()
  steamDir = steam.root
  cache = [...steam.games, ...epicGames()].sort((a, b) => a.name.localeCompare(b.name))
  return cache
}

// Вертикальная обложка из кэша Steam. Новый Steam кладёт её в подпапку игры
function steamCover(appid) {
  if (!steamDir) return null
  const cacheDir = path.join(steamDir, 'appcache', 'librarycache')
  const flat = path.join(cacheDir, `${appid}_library_600x900.jpg`)
  if (fs.existsSync(flat)) return flat
  const stack = [path.join(cacheDir, appid)]
  for (let depth = 0; stack.length && depth < 3; depth++) {
    const dir = stack.shift()
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isFile() && /^library_600x900/.test(e.name)) return path.join(dir, e.name)
      if (e.isDirectory()) stack.push(path.join(dir, e.name))
    }
  }
  return null
}

function gameCover(game) {
  if (!game?.steamId) return null
  const file = steamCover(game.steamId)
  if (!file) return null
  try {
    return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`
  } catch {
    return null
  }
}

module.exports = { listGames, gameCover }
