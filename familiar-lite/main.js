// Главный процесс: создаёт окна (док, виджеты, поиск), хранит настройки,
// ищет установленные приложения и запускает их.
const { app, BrowserWindow, ipcMain, screen, shell, globalShortcut, Menu, net, nativeTheme } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const isWin = process.platform === 'win32'

// ---------- Настройки (лежат в %APPDATA%\familiar-lite\config.json) ----------

const DEFAULT_CONFIG = {
  theme: 'system', // system | light | dark
  // Воронеж по умолчанию — поменяй координаты под себя
  weather: { city: 'Воронеж', latitude: 51.67, longitude: 39.18 },
  pinned: isWin
    ? [
        { name: 'Проводник', path: 'C:\\Windows\\explorer.exe' },
        { name: 'Блокнот', path: 'C:\\Windows\\notepad.exe' },
        { name: 'Параметры', path: 'ms-settings:' }
      ]
    : [],
  reminders: []
}

const configPath = () => path.join(app.getPath('userData'), 'config.json')

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

let config

function saveConfig() {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2))
  // Сообщаем всем окнам, что настройки поменялись
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('config-changed', config)
}

// ---------- Поиск установленных приложений ----------

// Windows: ярлыки .lnk из меню «Пуск» (общего и пользовательского)
function windowsAppDirs() {
  return [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(app.getPath('appData'), 'Microsoft\\Windows\\Start Menu\\Programs'),
    app.getPath('desktop')
  ]
}

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

let appCache = null

function listApps() {
  if (appCache) return appCache
  let apps
  if (isWin) {
    apps = windowsAppDirs()
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
  appCache = apps
    .filter((a) => !seen.has(a.name.toLowerCase()) && seen.add(a.name.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
  return appCache
}

// Файлы с рабочего стола и из «Документов» тоже ищутся по Alt+Space
function listFiles() {
  const dirs = [app.getPath('desktop'), app.getPath('documents')]
  return dirs
    .flatMap((d) => {
      try {
        return fs.readdirSync(d, { withFileTypes: true }).map((e) => ({ name: e.name, path: path.join(d, e.name), isFile: true }))
      } catch {
        return []
      }
    })
    .filter((f) => !f.name.startsWith('.') && !/\.(lnk|url|ini)$/i.test(f.name))
}

// ---------- Запуск ----------

async function launch(item) {
  if (/^[a-z][a-z0-9+.-]*:(?!\\)/i.test(item.path)) {
    // URI: ms-settings:, https:// и т.п.
    await shell.openExternal(item.path)
  } else if (item.exec) {
    spawn(item.exec, { shell: true, detached: true, stdio: 'ignore' }).unref()
  } else {
    const err = await shell.openPath(item.path)
    if (err) console.error('Не удалось открыть', item.path, err)
  }
}

// ---------- Окна ----------

const SRC = path.join(__dirname, 'src')
const webPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }

let dockWin, launcherWin, widgetsWin

const DOCK_HEIGHT = 120

function createDock() {
  const { workArea } = screen.getPrimaryDisplay()
  dockWin = new BrowserWindow({
    x: workArea.x,
    y: workArea.y + workArea.height - DOCK_HEIGHT,
    width: workArea.width,
    height: DOCK_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    webPreferences
  })
  dockWin.setAlwaysOnTop(true, 'screen-saver')
  // Прозрачные участки окна пропускают клики к окнам под ним
  dockWin.setIgnoreMouseEvents(true, { forward: true })
  dockWin.loadFile(path.join(SRC, 'dock.html'))
}

function createLauncher() {
  const { workArea } = screen.getPrimaryDisplay()
  const width = 640
  launcherWin = new BrowserWindow({
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round(workArea.height * 0.2),
    width,
    height: 420,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences
  })
  launcherWin.loadFile(path.join(SRC, 'launcher.html'))
  launcherWin.on('blur', () => launcherWin.hide())
}

function createWidgets() {
  const { workArea } = screen.getPrimaryDisplay()
  const width = 300
  widgetsWin = new BrowserWindow({
    x: workArea.x + workArea.width - width - 16,
    y: workArea.y + 16,
    width,
    height: 520,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences
  })
  widgetsWin.loadFile(path.join(SRC, 'widgets.html'))
}

function toggleLauncher() {
  if (launcherWin.isVisible()) return launcherWin.hide()
  launcherWin.show()
  launcherWin.focus()
  launcherWin.webContents.send('launcher-opened')
}

function toggleWidgets() {
  widgetsWin.isVisible() ? widgetsWin.hide() : widgetsWin.showInactive()
}

// ---------- IPC: что окна могут попросить у главного процесса ----------

function registerIpc() {
  ipcMain.handle('config:get', () => config)
  ipcMain.handle('apps:list', () => listApps())
  ipcMain.handle('files:list', () => listFiles())
  ipcMain.handle('launch', (_e, item) => launch(item))

  ipcMain.handle('icon', async (_e, p) => {
    if (/^[a-z][a-z0-9+.-]*:(?!\\)/i.test(p)) return null
    try {
      return (await app.getFileIcon(p, { size: 'large' })).toDataURL()
    } catch {
      return null
    }
  })

  ipcMain.handle('dock:pin', (_e, item) => {
    if (!config.pinned.some((p) => p.path === item.path)) {
      config.pinned.push({ name: item.name, path: item.path, exec: item.exec })
      saveConfig()
    }
  })

  ipcMain.handle('dock:reorder', (_e, from, to) => {
    const [moved] = config.pinned.splice(from, 1)
    config.pinned.splice(to, 0, moved)
    saveConfig()
  })

  ipcMain.on('dock:menu', (e, index) => {
    const template = [
      { label: 'Открепить из дока', enabled: index >= 0, click: () => (config.pinned.splice(index, 1), saveConfig()) },
      { type: 'separator' },
      { label: 'Поиск (Alt+Space)', click: toggleLauncher },
      { label: 'Виджеты (Alt+W)', click: toggleWidgets },
      {
        label: 'Тема',
        submenu: ['system', 'light', 'dark'].map((t) => ({
          label: { system: 'Как в системе', light: 'Светлая', dark: 'Тёмная' }[t],
          type: 'radio',
          checked: config.theme === t,
          click: () => {
            config.theme = t
            nativeTheme.themeSource = t
            saveConfig()
          }
        }))
      },
      { label: 'Открыть файл настроек', click: () => shell.openPath(configPath()) },
      { type: 'separator' },
      { label: 'Выйти', click: () => app.quit() }
    ]
    Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(e.sender) })
  })

  // Док сам говорит, когда мышь над панелью — тогда окно ловит клики
  ipcMain.on('dock:hover', (_e, over) => dockWin.setIgnoreMouseEvents(!over, { forward: true }))

  ipcMain.on('launcher:hide', () => launcherWin.hide())
  ipcMain.on('launcher:toggle', toggleLauncher)

  ipcMain.handle('reminders:set', (_e, reminders) => {
    config.reminders = reminders
    saveConfig()
  })

  // Погода через Open-Meteo: бесплатно и без API-ключа
  ipcMain.handle('weather', async () => {
    const { latitude, longitude } = config.weather
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`
    const res = await net.fetch(url)
    if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`)
    return res.json()
  })
}

// ---------- Старт ----------

// Второй экземпляр не запускаем — просто открываем поиск в первом
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => toggleLauncher())

  app.whenReady().then(() => {
    config = loadConfig()
    nativeTheme.themeSource = config.theme
    registerIpc()
    createDock()
    createLauncher()
    createWidgets()

    if (!globalShortcut.register('Alt+Space', toggleLauncher)) {
      console.warn('Alt+Space занят другой программой (например, PowerToys Run)')
    }
    globalShortcut.register('Alt+W', toggleWidgets)

    // Список приложений собираем заранее, чтобы поиск открывался мгновенно
    setTimeout(listApps, 1000)
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('window-all-closed', () => app.quit())
}
