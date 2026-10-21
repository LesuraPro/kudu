// Главный процесс: создаёт окна (док, остров, виджеты, поиск), хранит настройки,
// ищет установленные приложения, запускает их и узнаёт, какая музыка играет.
const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  shell,
  globalShortcut,
  Menu,
  net,
  nativeTheme,
  session,
  desktopCapturer
} = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const readline = require('readline')
const { spawn } = require('child_process')

const isWin = process.platform === 'win32'
// FAMILIAR_DEMO=1 — подставить выдуманный трек (удобно проверять без музыки)
const isDemo = !!process.env.FAMILIAR_DEMO

// ---------- Настройки (лежат в %APPDATA%\familiar-lite\config.json) ----------

// Виджеты — отдельные окна, которые можно таскать по рабочему столу.
// Размер и место каждого запоминаются.
const WIDGETS = {
  clock: { title: 'Часы', width: 230, height: 250 },
  weather: { title: 'Погода', width: 260, height: 180 },
  visualizer: { title: 'Визуализатор', width: 340, height: 400, resizable: true },
  cassette: { title: 'Кассета', width: 380, height: 300 },
  tty: { title: 'Терминал familiar-tty', width: 640, height: 420, resizable: true },
  reminders: { title: 'Напоминания', width: 280, height: 260 }
}

const DEFAULT_CONFIG = {
  theme: 'dark', // system | light | dark
  // Воронеж по умолчанию — поменяй координаты под себя
  weather: { city: 'Воронеж', latitude: 51.67, longitude: 39.18 },
  island: true,
  pinned: isWin
    ? [
        { name: 'Проводник', path: 'C:\\Windows\\explorer.exe' },
        { name: 'Блокнот', path: 'C:\\Windows\\notepad.exe' },
        { name: 'Параметры', path: 'ms-settings:' }
      ]
    : [],
  reminders: [],
  widgets: Object.fromEntries(Object.keys(WIDGETS).map((name) => [name, { enabled: true }]))
}

const configPath = () => path.join(app.getPath('userData'), 'config.json')

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'))
    return { ...DEFAULT_CONFIG, ...saved, widgets: { ...DEFAULT_CONFIG.widgets, ...saved.widgets } }
  } catch {
    return structuredClone(DEFAULT_CONFIG)
  }
}

let config

function saveConfig() {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2))
  broadcast('config-changed', config)
}

function broadcast(channel, data) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, data)
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

const isUri = (p) => /^[a-z][a-z0-9+.-]*:(?!\\)/i.test(p)

async function launch(item) {
  if (isUri(item.path)) {
    // URI: ms-settings:, https:// и т.п.
    await shell.openExternal(item.path)
  } else if (item.exec) {
    spawn(item.exec, { shell: true, detached: true, stdio: 'ignore' }).unref()
  } else {
    const err = await shell.openPath(item.path)
    if (err) console.error('Не удалось открыть', item.path, err)
  }
}

// ---------- Музыка: что сейчас играет ----------
// На Windows спрашиваем систему через PowerShell (media.ps1), он работает
// со Spotify, браузерами, Яндекс Музыкой — со всем, что видно в регуляторе громкости.

let media = { status: 'none' }
let mediaProc = null
let mediaRestarts = 0

function setMedia(next) {
  // Обложку PowerShell присылает только при смене трека — сохраняем её
  if (!('art' in next) && next.key === media.key) next.art = media.art
  next.receivedAt = Date.now()
  media = next
  broadcast('media', media)
}

function startMedia() {
  if (isDemo) return startDemoMedia()
  if (!isWin) return

  // Из asar-архива PowerShell файл не прочитает — копируем скрипт рядом с настройками
  const script = path.join(app.getPath('userData'), 'media.ps1')
  fs.mkdirSync(path.dirname(script), { recursive: true })
  fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, 'media.ps1')))

  mediaProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
    windowsHide: true
  })
  readline.createInterface({ input: mediaProc.stdout }).on('line', (line) => {
    try {
      setMedia(JSON.parse(line))
    } catch {
      // не JSON — пропускаем
    }
  })
  mediaProc.stderr.on('data', (d) => console.error('[media]', String(d).trim()))
  mediaProc.on('exit', () => {
    mediaProc = null
    setMedia({ status: 'none' })
    // Пару раз пробуем перезапустить, дальше сдаёмся без спама
    if (!app.isQuitting && mediaRestarts++ < 3) setTimeout(startMedia, 5000)
  })
}

function startDemoMedia() {
  let position = 35
  let playing = true
  const tracks = [
    { title: 'zany', artist: 'DJ SENSX', album: 'zany', duration: 78 },
    { title: 'Кукла колдуна', artist: 'Король и Шут', album: 'Акустический альбом', duration: 203 }
  ]
  let i = 0
  const tick = () => {
    if (playing) position += 1
    if (position > tracks[i].duration) (i = (i + 1) % tracks.length), (position = 0)
    const t = tracks[i]
    setMedia({ status: playing ? 'playing' : 'paused', app: 'Spotify.exe', ...t, position, key: t.title, art: '' })
  }
  ipcMain.on('demo:cmd', (_e, cmd) => {
    if (cmd === 'toggle') playing = !playing
    if (cmd === 'next') (i = (i + 1) % tracks.length), (position = 0)
    if (cmd === 'prev') position = 0
    tick()
  })
  tick()
  setInterval(tick, 1000)
}

function mediaCommand(cmd) {
  if (isDemo) return ipcMain.emit('demo:cmd', null, cmd)
  mediaProc?.stdin.write(cmd + '\n')
}

// ---------- Окна ----------

const SRC = path.join(__dirname, 'src')
const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  sandbox: true,
  backgroundThrottling: false // анимации не должны замирать, когда окно не в фокусе
}

let dockWin, launcherWin, islandWin
const widgetWins = {}
let widgetsHidden = false

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

// «Остров» сверху по центру: пилюля, которая раскрывается в плеер
function createIsland() {
  const { workArea } = screen.getPrimaryDisplay()
  const width = 480
  islandWin = new BrowserWindow({
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y,
    width,
    height: 260,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    webPreferences
  })
  islandWin.setAlwaysOnTop(true, 'screen-saver')
  islandWin.setIgnoreMouseEvents(true, { forward: true })
  islandWin.loadFile(path.join(SRC, 'island.html'))
}

function createLauncher() {
  const { workArea } = screen.getPrimaryDisplay()
  const width = 640
  launcherWin = new BrowserWindow({
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round(workArea.height * 0.2),
    width,
    height: 440,
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

// Раскладка по умолчанию: две колонки у правого края экрана
function defaultBounds(name) {
  const { workArea } = screen.getPrimaryDisplay()
  const gap = 16
  const right = workArea.x + workArea.width - gap
  const col1 = ['clock', 'weather', 'reminders']
  const col2 = ['visualizer', 'cassette']
  const { width, height } = WIDGETS[name]
  const stackY = (list) => {
    let y = workArea.y + 70 // ниже острова
    for (const n of list) {
      if (n === name) break
      y += WIDGETS[n].height + gap
    }
    return y
  }
  if (col1.includes(name)) return { x: right - width, y: stackY(col1), width, height }
  if (col2.includes(name)) return { x: right - 280 - gap - width, y: stackY(col2), width, height }
  return { x: workArea.x + 40, y: workArea.y + 70, width, height }
}

function createWidget(name) {
  const def = WIDGETS[name]
  const bounds = config.widgets[name]?.bounds ?? defaultBounds(name)
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 200,
    minHeight: 160,
    frame: false,
    transparent: true,
    resizable: !!def.resizable,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences
  })
  win.loadFile(path.join(SRC, 'widget.html'), { query: { type: name } })
  win.once('ready-to-show', () => !widgetsHidden && win.showInactive())

  // Запоминаем, куда виджет перетащили и какого размера сделали
  let timer
  const remember = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (win.isDestroyed()) return
      config.widgets[name] = { ...config.widgets[name], bounds: win.getBounds() }
      saveConfig()
    }, 400)
  }
  win.on('moved', remember)
  win.on('resized', remember)
  win.on('closed', () => delete widgetWins[name])
  widgetWins[name] = win
}

function syncWidgets() {
  for (const name of Object.keys(WIDGETS)) {
    const enabled = config.widgets[name]?.enabled !== false
    if (enabled && !widgetWins[name]) createWidget(name)
    if (!enabled && widgetWins[name]) widgetWins[name].close()
  }
}

function toggleLauncher() {
  if (launcherWin.isVisible()) return launcherWin.hide()
  launcherWin.show()
  launcherWin.focus()
  launcherWin.webContents.send('launcher-opened')
}

function toggleWidgets() {
  widgetsHidden = !widgetsHidden
  for (const w of Object.values(widgetWins)) widgetsHidden ? w.hide() : w.showInactive()
}

function systemInfo() {
  const { workArea, size } = screen.getPrimaryDisplay()
  const cpus = os.cpus()
  return {
    user: os.userInfo().username,
    host: os.hostname(),
    os: isWin ? `Windows ${os.release()}` : `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpu: cpus[0]?.model.replace(/\s+/g, ' ').trim() ?? '?',
    cores: cpus.length,
    memTotal: os.totalmem(),
    memFree: os.freemem(),
    uptime: os.uptime(),
    resolution: `${size.width}x${size.height}`,
    workArea: `${workArea.width}x${workArea.height}`,
    electron: process.versions.electron,
    node: process.versions.node
  }
}

// ---------- IPC: что окна могут попросить у главного процесса ----------

function registerIpc() {
  ipcMain.handle('config:get', () => config)
  ipcMain.handle('apps:list', () => listApps())
  ipcMain.handle('files:list', () => listFiles())
  ipcMain.handle('launch', (_e, item) => launch(item))
  ipcMain.handle('sysinfo', () => systemInfo())
  ipcMain.handle('media:get', () => media)
  ipcMain.on('media:cmd', (_e, cmd) => mediaCommand(cmd))

  ipcMain.handle('icon', async (_e, p) => {
    if (isUri(p)) return null
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
      { label: 'Показать/скрыть виджеты (Alt+W)', click: toggleWidgets },
      {
        label: 'Виджеты',
        submenu: [
          ...Object.entries(WIDGETS).map(([name, def]) => ({
            label: def.title,
            type: 'checkbox',
            checked: config.widgets[name]?.enabled !== false,
            click: (item) => {
              config.widgets[name] = { ...config.widgets[name], enabled: item.checked }
              saveConfig()
              syncWidgets()
            }
          })),
          { type: 'separator' },
          {
            label: 'Вернуть раскладку по умолчанию',
            click: () => {
              for (const [name, win] of Object.entries(widgetWins)) {
                delete config.widgets[name].bounds
                win.setBounds(defaultBounds(name))
              }
              saveConfig()
            }
          }
        ]
      },
      {
        label: 'Остров сверху',
        type: 'checkbox',
        checked: config.island,
        click: (item) => {
          config.island = item.checked
          saveConfig()
          item.checked ? islandWin.showInactive() : islandWin.hide()
        }
      },
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

  // Окно-«оверлей» (док, остров) говорит, когда мышь над его видимой частью —
  // тогда окно ловит клики, в остальное время клики проходят насквозь
  ipcMain.on('mouse:capture', (e, over) => {
    BrowserWindow.fromWebContents(e.sender)?.setIgnoreMouseEvents(!over, { forward: true })
  })

  ipcMain.on('launcher:hide', () => launcherWin.hide())
  ipcMain.on('launcher:toggle', toggleLauncher)
  ipcMain.on('widgets:toggle', toggleWidgets)

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

// Визуализатор слушает звук системы (loopback) — так он прыгает под любую музыку.
// Chromium умеет это только на Windows; на других системах будет имитация.
function enableLoopbackAudio() {
  if (!isWin) return
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
        .catch(() => callback({}))
    },
    { useSystemPicker: false }
  )
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
    enableLoopbackAudio()
    startMedia()
    createDock()
    createIsland()
    if (!config.island) islandWin.hide()
    createLauncher()
    syncWidgets()

    if (!globalShortcut.register('Alt+Space', toggleLauncher)) {
      console.warn('Alt+Space занят другой программой (например, PowerToys Run)')
    }
    globalShortcut.register('Alt+W', toggleWidgets)

    // Список приложений собираем заранее, чтобы поиск открывался мгновенно
    setTimeout(listApps, 1000)
  })

  app.on('before-quit', () => {
    app.isQuitting = true
    mediaProc?.stdin.end()
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('window-all-closed', () => app.quit())
}
