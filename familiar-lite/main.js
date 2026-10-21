// Главный процесс: создаёт окна (панель, остров, док, виджеты, поиск), хранит настройки
// и связывает всё с системой. Работа с Windows и поиск вынесены в lib/.
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
const { spawn } = require('child_process')
const { pathToFileURL } = require('url')

const { startBridge } = require('./lib/bridge')
const { listApps, listFiles } = require('./lib/apps')
const { startStats, systemInfo, readBatteries } = require('./lib/system')
const { listGames, gameCover } = require('./lib/games')

const isWin = process.platform === 'win32'
// FAMILIAR_DEMO=1 — выдуманные трек, окна, игры и наушники (удобно проверять без Windows)
const isDemo = !!process.env.FAMILIAR_DEMO

// ---------- Виджеты ----------

// Каждый виджет — отдельное окно, которое можно таскать по рабочему столу.
// Порядок здесь = порядок раскладки по умолчанию (справа налево, сверху вниз).
const WIDGETS = {
  clock: { title: 'Часы', width: 230, height: 250 },
  weather: { title: 'Погода', width: 230, height: 180 },
  reminders: { title: 'Напоминания', width: 230, height: 260 },
  visualizer: { title: 'Визуализатор', width: 340, height: 400, resizable: true, minWidth: 140, minHeight: 140 },
  cassette: { title: 'Кассета', width: 340, height: 280 },
  eyes: { title: 'Глазки', width: 200, height: 200, resizable: true, minWidth: 110, minHeight: 110 },
  system: { title: 'Нагрузка', width: 320, height: 210, resizable: true },
  games: { title: 'Игры', width: 420, height: 320, resizable: true },
  tty: { title: 'Терминал familiar-tty', width: 640, height: 420, resizable: true }
}

// Свои виджеты: любой .js в %APPDATA%\familiar-lite\widgets\ (см. README)
const customDir = () => path.join(app.getPath('userData'), 'widgets')

function seedCustomWidgets() {
  const dir = customDir()
  if (fs.existsSync(dir)) return
  fs.mkdirSync(dir, { recursive: true })
  for (const f of fs.readdirSync(path.join(__dirname, 'examples'))) {
    fs.copyFileSync(path.join(__dirname, 'examples', f), path.join(dir, f))
  }
}

function customWidgets() {
  let files = []
  try {
    files = fs.readdirSync(customDir()).filter((f) => f.endsWith('.js'))
  } catch {
    return {}
  }
  return Object.fromEntries(
    files.map((f) => {
      const base = path.basename(f, '.js')
      return [`custom:${base}`, { title: base, width: 240, height: 240, resizable: true, file: path.join(customDir(), f) }]
    })
  )
}

const allWidgets = () => ({ ...WIDGETS, ...customWidgets() })

// ---------- Настройки (лежат в %APPDATA%\familiar-lite\config.json) ----------

const PROFILES = ['Основной', 'Учёба', 'Игры']

const DEFAULT_CONFIG = {
  theme: 'dark', // system | light | dark
  // Воронеж по умолчанию — поменяй координаты под себя
  weather: { city: 'Воронеж', latitude: 51.67, longitude: 39.18 },
  island: true,
  menubar: true,
  wallpaper: null,
  profile: PROFILES[0],
  // У каждого профиля свои закреплённые приложения и виджеты
  profiles: {},
  pinned: isWin
    ? [
        { name: 'Проводник', path: 'C:\\Windows\\explorer.exe' },
        { name: 'Блокнот', path: 'C:\\Windows\\notepad.exe' },
        { name: 'Параметры', path: 'ms-settings:' }
      ]
    : [],
  reminders: [],
  widgets: {}
}

const configPath = () => path.join(app.getPath('userData'), 'config.json')

function loadConfig() {
  try {
    return { ...structuredClone(DEFAULT_CONFIG), ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) }
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
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, data)
}

const widgetEnabled = (name) => config.widgets[name]?.enabled !== false

// ---------- Запуск ----------

const isUri = (p) => /^[a-z][a-z0-9+.-]*:(?!\\)/i.test(p)

async function launch(item) {
  if (isUri(item.path)) {
    // URI: ms-settings:, steam://, https:// и т.п.
    await shell.openExternal(item.path)
  } else if (item.exec) {
    spawn(item.exec, { shell: true, detached: true, stdio: 'ignore' }).unref()
  } else {
    const err = await shell.openPath(item.path)
    if (err) console.error('Не удалось открыть', item.path, err)
  }
}

// ---------- Мост к Windows: музыка и открытые окна ----------

let bridge
let media = { status: 'none' }
let openWindows = { list: [], foreground: 0 }
let dockJson = ''
let foreground = null
let menubarHwnd = null

function onBridgeMessage(msg) {
  if (msg.type === 'media') {
    // Обложку мост присылает только при смене трека — сохраняем её
    if (!('art' in msg) && msg.key === media.key) msg.art = media.art
    media = msg
    broadcast('media', media)
  } else if (msg.type === 'windows') {
    // Свои окна (док, виджеты) в списке не нужны
    const list = (msg.list ?? []).filter((w) => w.pid !== process.pid)
    openWindows = { list, foreground: msg.foreground }
    updateDock()
    updateForeground()
  } else if (msg.type === 'appbar' && menubarWin && !menubarWin.isDestroyed()) {
    // Windows выделил полосу под панель — ставим окно ровно в неё
    const [l, t, r, b] = msg.rect
    menubarWin.setBounds(screen.screenToDipRect(menubarWin, { x: l, y: t, width: r - l, height: b - t }))
  }
}

// «C:\…\Telegram.exe» → «Telegram»
function appName(group) {
  if (/applicationframehost\.exe$/i.test(group.path)) return group.title
  const base = path.basename(group.path || group.title).replace(/\.exe$/i, '')
  const known = { msedge: 'Edge', chrome: 'Chrome', firefox: 'Firefox', explorer: 'Проводник', code: 'VS Code', winword: 'Word' }
  return known[base.toLowerCase()] ?? base.charAt(0).toUpperCase() + base.slice(1)
}

// Куда ведёт закреплённый ярлык — чтобы понять, что приложение уже запущено
const targetCache = new Map()
function pinnedTarget(item) {
  if (!targetCache.has(item.path)) {
    let target = item.path
    if (isWin && /\.lnk$/i.test(target)) {
      try {
        target = shell.readShortcutLink(target).target || target
      } catch {
        // ярлык без цели (например, на UWP-приложение)
      }
    }
    targetCache.set(item.path, target.toLowerCase())
  }
  return targetCache.get(item.path)
}

function groupWindows() {
  const groups = new Map()
  for (const w of openWindows.list) {
    const key = (w.path || w.title).toLowerCase()
    if (!groups.has(key)) groups.set(key, { path: w.path, title: w.title, hwnds: [] })
    groups.get(key).hwnds.push(w.hwnd)
  }
  return groups
}

function dockState() {
  const groups = groupWindows()
  const pinned = config.pinned.map((p) => {
    const g = groups.get(pinnedTarget(p))
    if (g) g.claimed = true
    return { ...p, hwnds: g?.hwnds ?? [] }
  })
  const running = [...groups.values()]
    .filter((g) => !g.claimed && g.path)
    .map((g) => ({ name: appName(g), path: g.path, hwnds: g.hwnds }))
  return { pinned, running, foreground: openWindows.foreground }
}

// Док перерисовывается только когда что-то реально поменялось
function updateDock() {
  const state = dockState()
  const json = JSON.stringify(state)
  if (json === dockJson) return
  dockJson = json
  broadcast('dock', state)
}

function updateForeground() {
  const w = openWindows.list.find((x) => x.hwnd === openWindows.foreground)
  // Фокус на нашем окне (док, виджет) — оставляем прошлое приложение
  if (!w && openWindows.list.length && foreground) return
  const next = w ? { name: appName(w), title: w.title } : { name: 'Рабочий стол', title: '' }
  if (JSON.stringify(next) === JSON.stringify(foreground)) return
  foreground = next
  broadcast('foreground', foreground)
}

// Клик по запущенному приложению: если окон несколько — листаем их по кругу
function focusApp(hwnds) {
  if (!hwnds?.length) return
  const i = hwnds.indexOf(openWindows.foreground)
  const target = i >= 0 && hwnds.length > 1 ? hwnds[(i + 1) % hwnds.length] : hwnds[0]
  bridge.send(`focus ${target}`)
}

function pinItem(item) {
  if (config.pinned.some((p) => p.path === item.path)) return
  config.pinned.push({ name: item.name, path: item.path, exec: item.exec })
  saveConfig()
  updateDock()
}

// ---------- Окна ----------

const SRC = path.join(__dirname, 'src')
const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  sandbox: true,
  backgroundThrottling: false // анимации не должны замирать, когда окно не в фокусе
}

let dockWin, launcherWin, islandWin, menubarWin
const widgetWins = {}
let widgetsHidden = false

const DOCK_HEIGHT = 120
const MENUBAR_HEIGHT = 30

// Окно-«оверлей»: без рамки, прозрачное, поверх всех, клики насквозь
function overlay(bounds, file) {
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    webPreferences
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  win.loadFile(path.join(SRC, file))
  return win
}

function dockBounds() {
  const { workArea } = screen.getPrimaryDisplay()
  return { x: workArea.x, y: workArea.y + workArea.height - DOCK_HEIGHT, width: workArea.width, height: DOCK_HEIGHT }
}

function createDock() {
  dockWin = overlay(dockBounds(), 'dock.html')
}

// «Остров» сверху по центру: пилюля, которая раскрывается в плеер. Сидит прямо в верхней панели
function createIsland() {
  const { bounds } = screen.getPrimaryDisplay()
  const width = 480
  islandWin = overlay({ x: bounds.x + Math.round((bounds.width - width) / 2), y: bounds.y, width, height: 260 }, 'island.html')
  if (!config.island) islandWin.hide()
}

// Верхняя панель как в macOS. На Windows просим систему отдать ей полосу экрана
// (AppBar), чтобы развёрнутые окна не заезжали под неё
function createMenubar() {
  const { bounds } = screen.getPrimaryDisplay()
  menubarWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: MENUBAR_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false,
    webPreferences
  })
  menubarWin.setAlwaysOnTop(true, 'screen-saver')
  menubarWin.loadFile(path.join(SRC, 'menubar.html'))
  if (isWin) {
    menubarHwnd = menubarWin.getNativeWindowHandle().readBigUInt64LE(0).toString()
    const r = screen.dipToScreenRect(menubarWin, { x: bounds.x, y: bounds.y, width: bounds.width, height: MENUBAR_HEIGHT })
    bridge.send(`appbar ${menubarHwnd} ${r.x} ${r.y} ${r.x + r.width} ${r.height}`)
  }
}

function destroyMenubar() {
  if (menubarHwnd) bridge.send(`appbar-remove ${menubarHwnd}`)
  menubarHwnd = null
  menubarWin?.destroy()
  menubarWin = null
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

// Раскладка по умолчанию: колонки от правого края, пока влезает по высоте
function defaultBounds(name) {
  const { workArea } = screen.getPrimaryDisplay()
  const gap = 16
  const top = workArea.y + 16
  let x = workArea.x + workArea.width - gap
  let y = top
  let colWidth = 0
  for (const [n, def] of Object.entries(allWidgets())) {
    if (!widgetEnabled(n) && n !== name) continue
    if (y + def.height > workArea.y + workArea.height - DOCK_HEIGHT && y > top) {
      x -= colWidth + gap
      y = top
      colWidth = 0
    }
    if (n === name) return { x: Math.max(workArea.x, x - def.width), y, width: def.width, height: def.height }
    y += def.height + gap
    colWidth = Math.max(colWidth, def.width)
  }
  return { x: workArea.x + 40, y: top, width: 300, height: 300 }
}

function createWidget(name) {
  const def = allWidgets()[name]
  const bounds = config.widgets[name]?.bounds ?? defaultBounds(name)
  const win = new BrowserWindow({
    ...bounds,
    minWidth: def.minWidth ?? 200,
    minHeight: def.minHeight ?? 160,
    frame: false,
    transparent: true,
    resizable: !!def.resizable,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences
  })
  const query = def.file ? { type: path.basename(def.file, '.js'), custom: pathToFileURL(def.file).href } : { type: name }
  win.loadFile(path.join(SRC, 'widget.html'), { query })
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
  win.on('closed', () => widgetWins[name] === win && delete widgetWins[name])
  widgetWins[name] = win
}

function syncWidgets() {
  const all = allWidgets()
  for (const name of Object.keys(all)) {
    if (widgetEnabled(name) && !widgetWins[name]) createWidget(name)
    if (!widgetEnabled(name) && widgetWins[name]) widgetWins[name].close()
  }
  // Файл своего виджета удалили — закрываем окно
  for (const name of Object.keys(widgetWins)) if (!all[name]) widgetWins[name].close()
}

function closeAllWidgets() {
  for (const [name, win] of Object.entries(widgetWins)) {
    delete widgetWins[name]
    win.destroy()
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

// ---------- Профили ----------

function switchProfile(name) {
  if (name === config.profile) return
  config.profiles[config.profile] = { pinned: config.pinned, widgets: config.widgets }
  // Новый профиль начинается копией текущего
  const next = config.profiles[name] ?? structuredClone({ pinned: config.pinned, widgets: config.widgets })
  config.profile = name
  config.pinned = next.pinned
  config.widgets = next.widgets
  saveConfig()
  closeAllWidgets()
  syncWidgets()
  updateDock()
}

// ---------- Обои ----------

const WALLPAPERS = { planet: 'Красная планета', grid: 'Точечная сетка', horizon: 'Горизонт', paper: 'Светлая бумага' }

// Рисуем обои в скрытом окне на canvas под разрешение экрана и ставим через мост
async function applyWallpaper(style) {
  const d = screen.getPrimaryDisplay()
  const w = Math.round(d.size.width * d.scaleFactor)
  const h = Math.round(d.size.height * d.scaleFactor)
  const win = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences })
  try {
    await win.loadFile(path.join(SRC, 'wallpaper.html'), { query: { style, w: String(w), h: String(h) } })
    const dataUrl = await win.webContents.executeJavaScript('window.renderWallpaper()')
    const dir = path.join(app.getPath('userData'), 'wallpapers')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `${style}-${w}x${h}.png`)
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
    config.wallpaper = style
    saveConfig()
    if (isWin) bridge.send(`wallpaper ${file}`)
    else shell.showItemInFolder(file)
    return file
  } finally {
    win.destroy()
  }
}

// ---------- Меню ----------

const menus = {
  widgets: () => [
    ...Object.entries(allWidgets()).map(([name, def]) => ({
      label: def.file ? `${def.title} (свой)` : def.title,
      type: 'checkbox',
      checked: widgetEnabled(name),
      click: (item) => {
        config.widgets[name] = { ...config.widgets[name], enabled: item.checked }
        saveConfig()
        syncWidgets()
      }
    })),
    { type: 'separator' },
    { label: 'Показать/скрыть все (Alt+W)', click: toggleWidgets },
    {
      label: 'Вернуть раскладку по умолчанию',
      click: () => {
        for (const name of Object.keys(config.widgets)) delete config.widgets[name].bounds
        for (const [name, win] of Object.entries(widgetWins)) win.setBounds(defaultBounds(name))
        saveConfig()
      }
    },
    { label: 'Папка своих виджетов…', click: () => shell.openPath(customDir()) },
    { label: 'Обновить свои виджеты', click: syncWidgets }
  ],
  wallpaper: () =>
    Object.entries(WALLPAPERS).map(([style, label]) => ({
      label,
      type: 'radio',
      checked: config.wallpaper === style,
      click: () => applyWallpaper(style).catch((e) => console.error('Обои:', e))
    })),
  profile: () =>
    PROFILES.map((name) => ({ label: name, type: 'radio', checked: config.profile === name, click: () => switchProfile(name) })),
  theme: () =>
    ['system', 'light', 'dark'].map((t) => ({
      label: { system: 'Как в системе', light: 'Светлая', dark: 'Тёмная' }[t],
      type: 'radio',
      checked: config.theme === t,
      click: () => setTheme(t)
    })),
  familiar: () => [
    { label: 'Поиск (Alt+Space)', click: toggleLauncher },
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
      label: 'Верхняя панель',
      type: 'checkbox',
      checked: config.menubar,
      click: (item) => {
        config.menubar = item.checked
        saveConfig()
        item.checked ? createMenubar() : destroyMenubar()
      }
    },
    { label: 'Открыть файл настроек', click: () => shell.openPath(configPath()) },
    { type: 'separator' },
    { label: 'Выйти', click: () => app.quit() }
  ]
}

function setTheme(t) {
  config.theme = t
  nativeTheme.themeSource = t
  saveConfig()
}

function fullMenu(index, running) {
  return [
    running
      ? { label: `Закрепить «${running.name}» в доке`, click: () => pinItem(running) }
      : { label: 'Открепить из дока', enabled: index >= 0, click: () => (config.pinned.splice(index, 1), saveConfig(), updateDock()) },
    { type: 'separator' },
    { label: 'Виджеты', submenu: menus.widgets() },
    { label: 'Обои', submenu: menus.wallpaper() },
    { label: `Профиль: ${config.profile}`, submenu: menus.profile() },
    { label: 'Тема', submenu: menus.theme() },
    { type: 'separator' },
    ...menus.familiar()
  ]
}

// ---------- IPC: что окна могут попросить у главного процесса ----------

let stats = { cpu: 0, mem: 0 }
let devices = []

function registerIpc() {
  ipcMain.handle('config:get', () => config)
  ipcMain.handle('apps:list', () => listApps(app))
  ipcMain.handle('files:list', () => listFiles(app))
  ipcMain.handle('games:list', () => listGames(isDemo))
  ipcMain.handle('game:cover', (_e, id) => gameCover(listGames(isDemo).find((g) => g.id === id)))
  ipcMain.handle('launch', (_e, item) => launch(item))
  ipcMain.handle('sysinfo', () => systemInfo(screen))
  ipcMain.handle('media:get', () => media)
  ipcMain.on('media:cmd', (_e, cmd) => bridge.send(cmd))
  ipcMain.handle('dock:get', () => dockState())
  ipcMain.handle('foreground:get', () => foreground)
  ipcMain.handle('stats:get', () => stats)
  ipcMain.handle('devices:get', () => devices)
  ipcMain.handle('cursor:get', () => screen.getCursorScreenPoint())
  ipcMain.on('window:focus', (_e, hwnds) => focusApp(hwnds))
  ipcMain.on('theme:toggle', () => setTheme(nativeTheme.shouldUseDarkColors ? 'light' : 'dark'))

  ipcMain.handle('icon', async (_e, p) => {
    if (isUri(p)) return null
    try {
      return (await app.getFileIcon(p, { size: 'large' })).toDataURL()
    } catch {
      return null
    }
  })

  ipcMain.handle('dock:pin', (_e, item) => pinItem(item))

  ipcMain.handle('dock:reorder', (_e, from, to) => {
    const [moved] = config.pinned.splice(from, 1)
    config.pinned.splice(to, 0, moved)
    saveConfig()
    updateDock()
  })

  ipcMain.on('dock:menu', (e, index, running) => {
    Menu.buildFromTemplate(fullMenu(index, running)).popup({ window: BrowserWindow.fromWebContents(e.sender) })
  })

  // Пункты верхней панели открывают свои подменю прямо под собой
  ipcMain.on('menubar:menu', (e, name, x) => {
    const template = menus[name]?.()
    if (!template) return
    Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(e.sender), x: Math.round(x), y: MENUBAR_HEIGHT })
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

async function pollDevices() {
  devices = await readBatteries(isDemo)
  broadcast('devices', devices)
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
    seedCustomWidgets()
    registerIpc()
    enableLoopbackAudio()
    bridge = startBridge({ app, isDemo, onMessage: onBridgeMessage })

    if (config.menubar) createMenubar()
    createDock()
    createIsland()
    createLauncher()
    syncWidgets()

    // Панель заняла полосу сверху или поменялось разрешение — двигаем док к низу
    screen.on('display-metrics-changed', () => dockWin.setBounds(dockBounds()))

    startStats((s) => {
      stats = s
      broadcast('stats', s)
    })
    setTimeout(pollDevices, 3000)
    setInterval(pollDevices, 2 * 60 * 1000)

    if (!globalShortcut.register('Alt+Space', toggleLauncher)) {
      console.warn('Alt+Space занят другой программой (например, PowerToys Run)')
    }
    globalShortcut.register('Alt+W', toggleWidgets)

    // Список приложений и игр собираем заранее, чтобы поиск открывался мгновенно
    setTimeout(() => {
      listApps(app)
      listGames(isDemo)
    }, 1000)
  })

  app.on('before-quit', () => bridge?.stop())
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('window-all-closed', () => app.quit())
}
