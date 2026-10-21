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
  desktopCapturer,
  dialog,
  nativeImage,
  powerMonitor
} = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { pathToFileURL } = require('url')

const { startBridge } = require('./lib/bridge')
const { listApps, listFiles } = require('./lib/apps')
const { startStats, systemInfo, readBatteries } = require('./lib/system')
const { listGames, gameCover } = require('./lib/games')
const files = require('./lib/files')
const profiles = require('./lib/profiles')
const { createHost } = require('./lib/hosts')

const isWin = process.platform === 'win32'
// FAMILIAR_DEMO=1 — выдуманные трек, окна, игры и наушники (удобно проверять без Windows)
const isDemo = !!process.env.FAMILIAR_DEMO

// ---------- Виджеты ----------

// Каждый виджет — отдельное окно, которое можно таскать по рабочему столу.
// Порядок здесь = порядок раскладки по умолчанию (справа налево, сверху вниз).
// Каждое окно — отдельный процесс (~30–40 МБ), поэтому сразу включены только
// основные (on: true); остальные включаются в настройках одним щелчком
const WIDGETS = {
  clock: { title: 'Часы', width: 230, height: 250, on: true },
  weather: { title: 'Погода', width: 230, height: 180, on: true },
  calendar: { title: 'Календарь', width: 300, height: 380, on: true },
  visualizer: { title: 'Визуализатор', width: 340, height: 400, resizable: true, minWidth: 140, minHeight: 140, on: true },
  eyes: { title: 'Глазки', width: 200, height: 200, resizable: true, minWidth: 110, minHeight: 110, on: true },
  shortcuts: { title: 'Ярлыки', width: 300, height: 260, resizable: true, on: true },
  reminders: { title: 'Напоминания', width: 230, height: 260 },
  cassette: { title: 'Кассета', width: 340, height: 280 },
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

// Папку своих виджетов читаем один раз; «Обновить свои виджеты» сбрасывает кэш
let customCache = null
function customWidgets() {
  return (customCache ??= readCustomWidgets())
}

function readCustomWidgets() {
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

const DEFAULT_CONFIG = {
  theme: 'dark', // system | light | dark
  // Воронеж по умолчанию — поменяй координаты под себя
  weather: { city: 'Воронеж', latitude: 51.67, longitude: 39.18 },
  island: true,
  menubar: true,
  wallpaper: null, // 'planet' | 'grid' | … | 'custom:<путь к картинке>'
  profile: 'Основной',
  // Имя, фото и настройки профилей (см. lib/profiles.js)
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
  let loaded
  try {
    loaded = { ...structuredClone(DEFAULT_CONFIG), ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) }
  } catch {
    loaded = structuredClone(DEFAULT_CONFIG)
  }
  profiles.migrate(loaded)
  return loaded
}

let config

// Окна узнают об изменениях сразу, а на диск пишем не чаще раза в 300 мс:
// перетаскивание виджета или набор текста иначе дёргали бы диск десятки раз.
// quiet — изменение, которое окнам не интересно (например, координаты виджета)
let writeTimer = null
function saveConfig({ quiet = false } = {}) {
  clearTimeout(writeTimer)
  writeTimer = setTimeout(writeConfigNow, 300)
  if (!quiet) broadcast('config-changed', config)
}

function writeConfigNow() {
  clearTimeout(writeTimer)
  writeTimer = null
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2))
}

function broadcast(channel, data) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, data)
}

// Включён ли виджет: как решил пользователь, а если ещё не решал — как задумано по умолчанию
const widgetEnabled = (name) => config.widgets[name]?.enabled ?? !!allWidgets()[name]?.on

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
    const artChanged = 'art' in msg
    if (!artChanged && msg.key === media.key) msg.art = media.art
    const prev = media
    msg.at = Date.now()
    media = msg
    // Окна сами досчитывают позицию трека, поэтому рассылаем, только если что-то
    // поменялось по-настоящему: трек, пауза или перемотка. Обложку (сотни КБ) —
    // только когда она новая
    const expected = prev.position + (prev.status === 'playing' ? (msg.at - prev.at) / 1000 : 0)
    const same = prev.key === msg.key && prev.status === msg.status && prev.title === msg.title && Math.abs(msg.position - expected) < 2
    if (same && !artChanged) return
    const { art, ...light } = msg
    broadcast('media', artChanged ? msg : light)
  } else if (msg.type === 'windows') {
    // Свои окна (док, виджеты) в списке не нужны
    const list = (msg.list ?? []).filter((w) => w.pid !== process.pid)
    openWindows = { list, foreground: msg.foreground }
    updatePower({ fullscreen: !!msg.fullscreen })
    updateDock()
    updateForeground()
  } else if (msg.type === 'appbar' && menubarWin && !menubarWin.isDestroyed()) {
    // Windows выделил полосу под панель — ставим окно ровно в неё
    const [l, t, r, b] = msg.rect
    menubarWin.setBounds(screen.screenToDipRect(menubarWin, { x: l, y: t, width: r - l, height: b - t }))
  }
}

// ---------- Режим питания: когда анимации никому не нужны ----------
// paused — игра или фильм на весь экран, экран заблокирован, компьютер уснул:
//          виджеты всё равно не видно, анимации замирают;
// saver  — работа от батареи или 3 минуты без мыши и клавиатуры: вдвое меньше кадров;
// normal — всё как обычно.

const power = { fullscreen: false, locked: false, idle: false, battery: false }
let powerState = 'normal'

function updatePower(patch) {
  Object.assign(power, patch)
  const next = power.fullscreen || power.locked ? 'paused' : power.battery || power.idle ? 'saver' : 'normal'
  if (next === powerState) return
  powerState = next
  broadcast('power', powerState)
}

function watchPower() {
  powerMonitor.on('lock-screen', () => updatePower({ locked: true }))
  powerMonitor.on('unlock-screen', () => updatePower({ locked: false }))
  powerMonitor.on('suspend', () => updatePower({ locked: true }))
  powerMonitor.on('resume', () => updatePower({ locked: false }))
  powerMonitor.on('on-battery', () => updatePower({ battery: true }))
  powerMonitor.on('on-ac', () => updatePower({ battery: false }))
  updatePower({ battery: powerMonitor.isOnBatteryPower() })
  setInterval(() => updatePower({ idle: powerMonitor.getSystemIdleTime() >= 180 }), 15000)
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

// Закреплённая папка в доке открывается «веером», а не в Проводнике
const dirCache = new Map()
function isPinnedDir(item) {
  if (isUri(item.path) || item.exec) return false
  if (!dirCache.has(item.path)) dirCache.set(item.path, files.isDirTarget(item.path))
  return dirCache.get(item.path)
}

function dockState() {
  const groups = groupWindows()
  const pinned = config.pinned.map((p) => {
    const g = groups.get(pinnedTarget(p))
    if (g) g.claimed = true
    return { ...p, hwnds: g?.hwnds ?? [], isDir: isPinnedDir(p) }
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
  // Окно полностью закрыто другими или свёрнуто — Chromium перестаёт его рисовать.
  // На анимации видимых, но не активных окон это не влияет
  backgroundThrottling: true
}

let dockWin, launcherWin, islandWin, menubarWin, settingsWin, filesWin
const widgetWins = {}
const widgetsCreating = new Set()
// Два процесса на всё встроенное: один для «оболочки» (панель, остров, док, поиск),
// второй для виджетов. Свои виджеты — в отдельных процессах: это чужой код,
// и если он зависнет, остальное продолжит работать (см. lib/hosts.js)
let shellHost, widgetHost
let widgetsHidden = false

const DOCK_HEIGHT = 120 // сколько места док занимает внизу (для раскладки виджетов)
const DOCK_STACK_HEIGHT = 470 // на время «веера» папки окно дока вырастает вверх
const MENUBAR_HEIGHT = 30

// Окно-«оверлей»: без рамки, прозрачное, поверх всех, клики насквозь
async function overlay(bounds, file) {
  const win = await shellHost.open(file, null, {
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: false
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })
  return win
}

let dockExpanded = false

function dockBounds() {
  const { workArea } = screen.getPrimaryDisplay()
  // Обычно окно дока не выше самого дока: меньше прозрачной площади поверх экрана —
  // меньше событий мыши, которые ему приходится пропускать насквозь
  const height = dockExpanded ? DOCK_STACK_HEIGHT : DOCK_HEIGHT
  return { x: workArea.x, y: workArea.y + workArea.height - height, width: workArea.width, height }
}

async function createDock() {
  dockWin = await overlay(dockBounds(), 'dock.html')
}

// «Остров» сверху по центру: пилюля, которая раскрывается в плеер. Сидит прямо в верхней панели
async function createIsland() {
  const { bounds } = screen.getPrimaryDisplay()
  const width = 480
  islandWin = await overlay({ x: bounds.x + Math.round((bounds.width - width) / 2), y: bounds.y, width, height: 260 }, 'island.html')
  if (!config.island) islandWin.hide()
}

// Верхняя панель как в macOS. На Windows просим систему отдать ей полосу экрана
// (AppBar), чтобы развёрнутые окна не заезжали под неё
async function createMenubar() {
  if (menubarWin) return
  const { bounds } = screen.getPrimaryDisplay()
  menubarWin = await shellHost.open('menubar.html', null, {
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
    focusable: false
  })
  menubarWin.setAlwaysOnTop(true, 'screen-saver')
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

async function createLauncher() {
  const { workArea } = screen.getPrimaryDisplay()
  const width = 640
  launcherWin = await shellHost.open('launcher.html', null, {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round(workArea.height * 0.2),
    width,
    height: 440,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false
  })
  launcherWin.on('blur', () => launcherWin.hide())
}

// Раскладка по умолчанию: колонки от правого края, пока влезает по высоте
function defaultBounds(name) {
  const { workArea, bounds } = screen.getPrimaryDisplay()
  const gap = 16
  // Ниже верхней панели, даже если Windows не выделил под неё полосу (или это не Windows)
  const top = Math.max(workArea.y, bounds.y + (config.menubar ? MENUBAR_HEIGHT : 0)) + 16
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

async function createWidget(name) {
  const def = allWidgets()[name]
  const bounds = config.widgets[name]?.bounds ?? defaultBounds(name)
  const options = {
    ...bounds,
    minWidth: def.minWidth ?? 200,
    minHeight: def.minHeight ?? 160,
    frame: false,
    transparent: true,
    resizable: !!def.resizable,
    skipTaskbar: true,
    hasShadow: false,
    show: false
  }
  let win
  widgetsCreating.add(name)
  try {
    if (def.file) {
      // Свой виджет — в своём процессе
      win = new BrowserWindow({ ...options, webPreferences })
      win.loadFile(path.join(SRC, 'widget.html'), { query: { type: path.basename(def.file, '.js'), custom: pathToFileURL(def.file).href } })
    } else {
      win = await widgetHost.open('widget.html', { type: name }, options)
    }
  } finally {
    widgetsCreating.delete(name)
  }
  // Пока окно создавалось, виджет успели выключить
  if (!widgetEnabled(name)) return win.destroy()

  let shown = false
  const show = () => !shown && !win.isDestroyed() && !widgetsHidden && ((shown = true), win.showInactive())
  win.once('ready-to-show', show)
  setTimeout(show, 2000) // на случай, если ready-to-show уже прошёл

  // Запоминаем, куда виджет перетащили и какого размера сделали
  let timer
  const remember = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (win.isDestroyed()) return
      config.widgets[name] = { ...config.widgets[name], bounds: win.getBounds() }
      saveConfig({ quiet: true })
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
    if (widgetEnabled(name) && !widgetWins[name] && !widgetsCreating.has(name)) createWidget(name)
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
  if (!launcherWin) return
  if (launcherWin.isVisible()) return launcherWin.hide()
  launcherWin.show()
  launcherWin.focus()
  launcherWin.webContents.send('launcher-opened')
}

function toggleWidgets() {
  widgetsHidden = !widgetsHidden
  for (const w of Object.values(widgetWins)) widgetsHidden ? w.hide() : w.showInactive()
}

// ---------- Обычные окна: настройки и файлы ----------

// Окно с родной кнопкой «закрыть/свернуть» Windows, но без стандартной рамки
function appWindow(file, query, size) {
  const dark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    ...size,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: dark ? '#f2f2f2' : '#111111', height: 44 },
    backgroundColor: dark ? '#0b0b0d' : '#f2f2f2',
    show: false,
    webPreferences
  })
  win.loadFile(path.join(SRC, file), { query })
  win.once('ready-to-show', () => win.show())
  return win
}

function openSettings(page = 'profile') {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show()
    settingsWin.focus()
    settingsWin.webContents.send('settings:page', page)
    return
  }
  settingsWin = appWindow('settings.html', { page }, { width: 860, height: 600, minWidth: 700, minHeight: 460 })
}

function openFiles(dir) {
  dir ??= files.ensureFamiliarDir(app)
  if (filesWin && !filesWin.isDestroyed()) {
    filesWin.show()
    filesWin.focus()
    filesWin.webContents.send('files:goto', dir)
    return
  }
  filesWin = appWindow('files.html', { dir }, { width: 900, height: 580, minWidth: 560, minHeight: 360 })
}

// Окна с родной кнопкой «закрыть» перекрашиваем при смене темы
nativeTheme.on('updated', () => {
  const dark = nativeTheme.shouldUseDarkColors
  for (const w of [settingsWin, filesWin]) {
    if (!w || w.isDestroyed()) continue
    w.setTitleBarOverlay({ color: '#00000000', symbolColor: dark ? '#f2f2f2' : '#111111', height: 44 })
    w.setBackgroundColor(dark ? '#0b0b0d' : '#f2f2f2')
  }
})

// ---------- Профили ----------

// Применить то, что зависит от профиля: тему, обои, док и виджеты
function applyProfile() {
  nativeTheme.themeSource = config.theme
  saveConfig()
  closeAllWidgets()
  syncWidgets()
  updateDock()
  if (config.wallpaper) applyWallpaper(config.wallpaper).catch((e) => console.error('Обои:', e))
}

function switchProfile(id) {
  if (profiles.switchTo(config, id)) applyProfile()
}

const IMAGE_FILTERS = [{ name: 'Картинки', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]

// Фото профиля: обрезаем до квадрата, уменьшаем и храним прямо в config.json
async function chooseProfilePhoto(id) {
  const { canceled, filePaths } = await dialog.showOpenDialog({ title: 'Фото профиля', properties: ['openFile'], filters: IMAGE_FILTERS })
  if (canceled || !filePaths[0]) return false
  const img = nativeImage.createFromPath(filePaths[0])
  if (img.isEmpty()) return false
  const { width, height } = img.getSize()
  const side = Math.min(width, height)
  const square = img
    .crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
    .resize({ width: 128, height: 128, quality: 'best' })
  profiles.update(config, id, { photo: square.toDataURL() })
  saveConfig()
  return true
}

// ---------- Обои ----------

const WALLPAPERS = { planet: 'Красная планета', grid: 'Точечная сетка', horizon: 'Горизонт', paper: 'Светлая бумага' }

// value — название стиля ('planet') или 'custom:<путь к своей картинке>'
async function applyWallpaper(value) {
  const file = value.startsWith('custom:') ? value.slice('custom:'.length) : await renderWallpaper(value)
  config.wallpaper = value
  saveConfig()
  if (isWin) bridge.send(`wallpaper ${file}`)
  else if (!isDemo) shell.showItemInFolder(file)
  return file
}

// Рисуем обои в скрытом окне на canvas под разрешение экрана
async function renderWallpaper(style) {
  const d = screen.getPrimaryDisplay()
  const w = Math.round(d.size.width * d.scaleFactor)
  const h = Math.round(d.size.height * d.scaleFactor)
  const dir = path.join(app.getPath('userData'), 'wallpapers')
  const file = path.join(dir, `${style}-${w}x${h}.png`)
  if (fs.existsSync(file)) return file
  const win = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences })
  try {
    await win.loadFile(path.join(SRC, 'wallpaper.html'), { query: { style, w: String(w), h: String(h) } })
    const dataUrl = await win.webContents.executeJavaScript('window.renderWallpaper()')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
    return file
  } finally {
    win.destroy()
  }
}

// Своя картинка: копируем к себе, чтобы обои не пропали, если оригинал переместят
async function chooseWallpaper() {
  const { canceled, filePaths } = await dialog.showOpenDialog({ title: 'Свои обои', properties: ['openFile'], filters: IMAGE_FILTERS })
  if (canceled || !filePaths[0]) return null
  const dir = path.join(app.getPath('userData'), 'wallpapers')
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `custom-${Date.now()}${path.extname(filePaths[0])}`)
  fs.copyFileSync(filePaths[0], dest)
  return applyWallpaper(`custom:${dest}`)
}

// ---------- Настройки ----------

function setTheme(t) {
  config.theme = t
  nativeTheme.themeSource = t
  saveConfig()
}

function setSetting(key, value) {
  if (key === 'theme') return setTheme(value)
  if (key === 'island') {
    config.island = !!value
    value ? islandWin.showInactive() : islandWin.hide()
  } else if (key === 'menubar') {
    config.menubar = !!value
    if (value) createMenubar()
    if (!value) destroyMenubar()
  } else if (key === 'weather') {
    const { city, latitude, longitude } = value
    if (typeof city !== 'string' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    config.weather = { city, latitude, longitude }
  } else {
    return
  }
  saveConfig()
}

function resetLayout() {
  for (const name of Object.keys(config.widgets)) delete config.widgets[name].bounds
  for (const [name, win] of Object.entries(widgetWins)) win.setBounds(defaultBounds(name))
  saveConfig()
}

function setWidgetEnabled(name, enabled) {
  config.widgets[name] = { ...config.widgets[name], enabled }
  saveConfig()
  syncWidgets()
}

// ---------- Меню ----------

const menus = {
  widgets: () => [
    ...Object.entries(allWidgets()).map(([name, def]) => ({
      label: def.file ? `${def.title} (свой)` : def.title,
      type: 'checkbox',
      checked: widgetEnabled(name),
      click: (item) => setWidgetEnabled(name, item.checked)
    })),
    { type: 'separator' },
    { label: 'Показать/скрыть все (Alt+W)', click: toggleWidgets },
    { label: 'Вернуть раскладку по умолчанию', click: resetLayout },
    { label: 'Папка своих виджетов…', click: () => shell.openPath(customDir()) },
    { label: 'Обновить свои виджеты', click: () => ((customCache = null), syncWidgets()) }
  ],
  wallpaper: () => [
    ...Object.entries(WALLPAPERS).map(([style, label]) => ({
      label,
      type: 'radio',
      checked: config.wallpaper === style,
      click: () => applyWallpaper(style).catch((e) => console.error('Обои:', e))
    })),
    { label: 'Своя картинка…', type: 'radio', checked: !!config.wallpaper?.startsWith('custom:'), click: () => chooseWallpaper() },
    { type: 'separator' },
    { label: 'Настройки обоев…', click: () => openSettings('appearance') }
  ],
  profile: () => [
    ...profiles.list(config).map((p) => ({ label: p.name, type: 'radio', checked: p.current, click: () => switchProfile(p.id) })),
    { type: 'separator' },
    { label: 'Настройки профилей…', click: () => openSettings('profile') }
  ],
  theme: () =>
    ['system', 'light', 'dark'].map((t) => ({
      label: { system: 'Как в системе', light: 'Светлая', dark: 'Тёмная' }[t],
      type: 'radio',
      checked: config.theme === t,
      click: () => setTheme(t)
    })),
  familiar: () => [
    { label: 'Настройки…', click: () => openSettings() },
    { label: 'Файлы', click: () => openFiles() },
    { label: 'Поиск (Alt+Space)', click: toggleLauncher },
    { type: 'separator' },
    { label: 'Остров сверху', type: 'checkbox', checked: config.island, click: (item) => setSetting('island', item.checked) },
    { label: 'Верхняя панель', type: 'checkbox', checked: config.menubar, click: (item) => setSetting('menubar', item.checked) },
    { type: 'separator' },
    { label: 'Выйти', accelerator: 'Ctrl+Alt+Q', click: () => app.quit() }
  ]
}

function fullMenu(index, running) {
  return [
    running
      ? { label: `Закрепить «${running.name}» в доке`, click: () => pinItem(running) }
      : { label: 'Открепить из дока', enabled: index >= 0, click: () => (config.pinned.splice(index, 1), saveConfig(), updateDock()) },
    { type: 'separator' },
    { label: 'Виджеты', submenu: menus.widgets() },
    { label: 'Обои', submenu: menus.wallpaper() },
    { label: `Профиль: ${profiles.current(config).name}`, submenu: menus.profile() },
    { label: 'Тема', submenu: menus.theme() },
    { type: 'separator' },
    ...menus.familiar()
  ]
}

// ---------- IPC: что окна могут попросить у главного процесса ----------

let stats = { cpu: 0, mem: 0 }
let filesCache = null
let devices = []

function registerIpc() {
  ipcMain.handle('config:get', () => config)
  ipcMain.handle('apps:list', () => listApps(app))
  // Для поиска: рабочий стол, «Документы» и всё из папки Familiar
  // Обходить папки при каждом Alt+Space незачем: список живёт 30 секунд
  // или до первого изменения в папке Familiar
  ipcMain.handle('files:list', () => {
    if (!filesCache || Date.now() - filesCache.at > 30000) {
      const seen = new Set()
      const list = [...files.searchFamiliar(app), ...listFiles(app)].filter((f) => !seen.has(f.path) && seen.add(f.path))
      filesCache = { at: Date.now(), list }
    }
    return filesCache.list
  })
  ipcMain.handle('games:list', () => listGames(isDemo))
  ipcMain.handle('game:cover', (_e, id) => gameCover(listGames(isDemo).find((g) => g.id === id)))
  ipcMain.handle('launch', (_e, item) => launch(item))
  ipcMain.handle('sysinfo', () => systemInfo(screen))
  ipcMain.handle('media:get', () => media)
  ipcMain.on('media:cmd', (_e, cmd) => bridge.send(cmd))
  ipcMain.handle('dock:get', () => dockState())
  ipcMain.handle('foreground:get', () => foreground)
  ipcMain.handle('stats:get', () => stats)
  ipcMain.handle('power:get', () => powerState)
  ipcMain.handle('devices:get', () => devices)
  ipcMain.handle('cursor:get', () => screen.getCursorScreenPoint())
  ipcMain.on('window:focus', (_e, hwnds) => focusApp(hwnds))
  ipcMain.on('theme:toggle', () => setTheme(nativeTheme.shouldUseDarkColors ? 'light' : 'dark'))

  // Иконки достаются из системы и кодируются в PNG — это не бесплатно, поэтому кэшируем
  const icons = new Map()
  ipcMain.handle('icon', (_e, p) => {
    if (isUri(p)) return null
    if (!icons.has(p)) {
      icons.set(
        p,
        app.getFileIcon(p, { size: 'large' }).then(
          (img) => img.toDataURL(),
          () => null
        )
      )
    }
    return icons.get(p)
  })
  ipcMain.handle('dock:expand', (_e, on) => {
    dockExpanded = !!on
    dockWin?.setBounds(dockBounds())
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

  // Папка Familiar, «Ярлыки» и «Файлы»
  ipcMain.handle('places', () => files.places(app))
  ipcMain.handle('folder:list', (_e, dir) => files.listFolder(dir ? files.linkTarget(dir) : files.ensureFamiliarDir(app)))
  ipcMain.handle('shortcut:add', (_e, targets) => {
    for (const t of targets) {
      try {
        files.addShortcut(app, t)
      } catch (err) {
        console.error('Ярлык не создан:', t, err.message)
      }
    }
  })
  ipcMain.on('shortcut:menu', (e, item) => {
    const inFamiliar = path.dirname(item.path) === files.familiarDir(app)
    const template = [
      { label: 'Открыть', click: () => launch(item) },
      { label: 'Показать в Проводнике', click: () => shell.showItemInFolder(files.linkTarget(item.path)) },
      ...(item.isDir ? [{ label: 'Открыть в «Файлах»', click: () => openFiles(files.linkTarget(item.path)) }] : []),
      { type: 'separator' },
      {
        label: item.isLink ? 'Убрать ярлык (оригинал останется)' : 'Убрать из Familiar (в корзину)',
        enabled: inFamiliar,
        click: () => files.removeFromFamiliar(app, item.path).catch((err) => dialog.showErrorBox('Не получилось', err.message))
      }
    ]
    Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(e.sender) })
  })
  ipcMain.on('file:reveal', (_e, p) => shell.showItemInFolder(files.linkTarget(p)))
  ipcMain.on('files:open', (_e, dir) => openFiles(dir))

  // Окно настроек
  ipcMain.on('settings:open', (_e, page) => openSettings(page))
  ipcMain.handle('settings:set', (_e, key, value) => setSetting(key, value))
  ipcMain.handle('widgets:list', () =>
    Object.entries(allWidgets()).map(([name, def]) => ({ name, title: def.title, custom: !!def.file, enabled: widgetEnabled(name) }))
  )
  ipcMain.handle('widgets:set', (_e, name, enabled) => setWidgetEnabled(name, !!enabled))
  ipcMain.handle('widgets:reset', () => resetLayout())
  ipcMain.on('widgets:folder', () => shell.openPath(customDir()))
  ipcMain.handle('profiles:list', () => profiles.list(config))
  ipcMain.handle('profiles:switch', (_e, id) => switchProfile(id))
  ipcMain.handle('profiles:create', (_e, name) => {
    const id = profiles.create(config, String(name ?? ''))
    saveConfig()
    return id
  })
  ipcMain.handle('profiles:remove', (_e, id) => profiles.remove(config, id) && saveConfig())
  ipcMain.handle('profiles:rename', (_e, id, name) => profiles.update(config, id, { name: String(name ?? '') }) && saveConfig())
  ipcMain.handle('profiles:photo', (_e, id) => chooseProfilePhoto(id))
  ipcMain.handle('profiles:photo-clear', (_e, id) => profiles.update(config, id, { photo: null }) && saveConfig())
  ipcMain.handle('wallpapers:list', () => WALLPAPERS)
  ipcMain.handle('wallpaper:apply', (_e, style) => applyWallpaper(style))
  ipcMain.handle('wallpaper:choose', () => chooseWallpaper())
  ipcMain.on('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.on('app:quit', () => app.quit())

  // Поиск города для погоды (геокодер Open-Meteo, тоже без ключа)
  ipcMain.handle('geo:search', async (_e, query) => {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=ru&format=json`
    const res = await net.fetch(url)
    if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`)
    const data = await res.json()
    return (data.results ?? []).map((r) => ({
      city: r.name,
      region: [r.admin1, r.country].filter(Boolean).join(', '),
      latitude: r.latitude,
      longitude: r.longitude
    }))
  })

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

    watchPower()
    shellHost = createHost(SRC, webPreferences)
    widgetHost = createHost(SRC, webPreferences)
    if (config.menubar) createMenubar()
    createDock()
    createIsland()
    createLauncher()
    syncWidgets()

    // Панель заняла полосу сверху или поменялось разрешение — двигаем док к низу
    screen.on('display-metrics-changed', () => dockWin?.setBounds(dockBounds()))

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
    // Как в оригинале: Ctrl+Alt+Q — выйти. Открытые программы Windows продолжат работать
    globalShortcut.register('Control+Alt+Q', () => app.quit())

    // Что-то положили в папку Familiar или убрали — обновляем «Ярлыки» и «Файлы»
    try {
      let timer
      fs.watch(files.ensureFamiliarDir(app), () => {
        clearTimeout(timer)
        filesCache = null
        timer = setTimeout(() => broadcast('familiar-changed'), 300)
      })
    } catch (err) {
      console.error('Не получилось следить за папкой Familiar:', err.message)
    }

    // Список приложений и игр собираем заранее, чтобы поиск открывался мгновенно
    setTimeout(() => {
      listApps(app)
      listGames(isDemo)
    }, 1000)
  })

  app.on('before-quit', () => {
    if (writeTimer) writeConfigNow()
    bridge?.stop()
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('window-all-closed', () => app.quit())
}
