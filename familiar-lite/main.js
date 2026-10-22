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
  powerMonitor,
  webContents,
  clipboard,
  Notification
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
const convert = require('./lib/convert')
const palette = require('./lib/palette')

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
  tty: { title: 'Терминал familiar-tty', width: 640, height: 420, resizable: true },
  schedule: { title: 'Расписание пар', width: 300, height: 340, resizable: true, minHeight: 220, on: true },
  workout: { title: 'Тренировки', width: 300, height: 380, resizable: true, minHeight: 320 },
  notes: { title: 'Заметки', width: 280, height: 260, resizable: true },
  countdown: { title: 'Обратный отсчёт', width: 230, height: 170, resizable: true, minHeight: 150 }
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
  wallpaper: null, // 'moon' | 'planet' | … | 'custom:<путь к картинке>'
  // Палитра: moon — «Луна и клинок», nothing — чёрное с красным, wallpaper — по обоям
  palette: 'moon',
  wallpaperPalette: null, // цвета, подобранные по текущим обоям (lib/palette.js)
  eco: false, // эко-режим: вдвое меньше кадров везде, даже от сети
  searchEngine: 'yandex', // поиск в интернете из Alt+Space: yandex | google
  widgetData: {}, // данные виджетов: заметки, тренировки, расписание, обратный отсчёт
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
  widgets: {},
  // Конвертер в духе DragShift: потащил файл, нажал клавишу — круговое меню
  dragshift: {
    enabled: true,
    key: 'shift', // shift | ctrl | alt
    output: 'beside', // beside — рядом с оригиналом, folder — в подпапку «Преобразовано»
    quality: 0.82, // качество JPG/WebP
    targetKb: 500, // «≤ размер»: до скольких КБ сжимать
    dpi: 150, // PDF → картинки
    sendTo: true // пункт «Отправить → Familiar — преобразовать» в Проводнике
  }
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
  loaded.dragshift = { ...DEFAULT_CONFIG.dragshift, ...loaded.dragshift }
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
  } else if (msg.type === 'dragshift') {
    onDragshiftTrigger(msg)
  } else if (msg.type === 'dragshift-key') {
    // Ещё раз нажали Shift, не отпуская файл, — переключаем кольцо (если файл уже над меню)
    if (radialMode === 'drag' && radialGotDrag) radialWin.webContents.send('radial:toggle')
  } else if (msg.type === 'dragshift-end') {
    // Кнопку отпустили (бросили файл) или нажали Esc. Даём броску долететь и прячем меню
    setTimeout(() => radialMode === 'drag' && hideRadial(), 120)
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
  // Эко-режим (настройка) — всегда как от батареи: вдвое меньше кадров
  const next = power.fullscreen || power.locked ? 'paused' : power.battery || power.idle || config?.eco ? 'saver' : 'normal'
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
  backgroundThrottling: true,
  // Проверка орфографии в полях оболочки не нужна, а словари держатся в памяти
  spellcheck: false
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
// Цвета окна до загрузки страницы и кнопок «свернуть/закрыть» — из палитры
function windowColors() {
  const p = currentPalette()
  const dark = nativeTheme.shouldUseDarkColors
  return { background: dark ? p.solid.dark : p.solid.light, symbols: dark ? p.dark['--text'] : p.light['--text'] }
}

function appWindow(file, query, size) {
  const colors = windowColors()
  const win = new BrowserWindow({
    ...size,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: colors.symbols, height: 44 },
    backgroundColor: colors.background,
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

// Окна с родной кнопкой «закрыть» перекрашиваем при смене темы и палитры
function recolorAppWindows() {
  const colors = windowColors()
  for (const w of [settingsWin, filesWin, ...toolWins]) {
    if (!w || w.isDestroyed()) continue
    w.setTitleBarOverlay({ color: '#00000000', symbolColor: colors.symbols, height: 44 })
    w.setBackgroundColor(colors.background)
  }
}
nativeTheme.on('updated', recolorAppWindows)

// ---------- Палитра ----------
// Значения CSS-переменных для всех окон. Окна получают их через preload (palette:get / palette)

function currentPalette() {
  if (config.palette === 'wallpaper' && config.wallpaperPalette) return config.wallpaperPalette
  return palette.PRESETS[config.palette] ?? palette.PRESETS.moon
}

let paletteCache = null
function paletteCss() {
  const p = currentPalette()
  if (paletteCache?.p !== p) paletteCache = { p, css: palette.toCss(p) }
  return paletteCache.css
}

function broadcastPalette() {
  const css = paletteCss()
  for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed()) wc.send('palette', css)
  recolorAppWindows()
}

function setPalette(name) {
  if (!['moon', 'nothing', 'wallpaper'].includes(name)) return
  config.palette = name
  saveConfig()
  broadcastPalette()
}

// Подобрать палитру по картинке обоев (в рабочем окне конвертера, он умеет любые форматы)
async function updateWallpaperPalette(file) {
  try {
    const { rgba } = await convert.imagePixels(convertCtx(), file)
    config.wallpaperPalette = palette.fromPixels(rgba, { rgba: true })
    saveConfig()
    if (config.palette === 'wallpaper') broadcastPalette()
  } catch (err) {
    console.error('Палитра по обоям:', err.message)
  }
}

// ---------- Профили ----------

// Применить то, что зависит от профиля: тему, обои, док и виджеты
function applyProfile() {
  nativeTheme.themeSource = config.theme
  saveConfig()
  closeAllWidgets()
  syncWidgets()
  updateDock()
  broadcastPalette()
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

const WALLPAPERS = { moon: 'Луна и клинок', planet: 'Красная планета', grid: 'Точечная сетка', horizon: 'Горизонт', paper: 'Светлая бумага' }

// value — название стиля ('moon') или 'custom:<путь к своей картинке>'
async function applyWallpaper(value) {
  const file = value.startsWith('custom:') ? value.slice('custom:'.length) : await renderWallpaper(value)
  const changed = config.wallpaper !== value || !config.wallpaperPalette
  config.wallpaper = value
  saveConfig()
  if (isWin) bridge.send(`wallpaper ${file}`)
  else if (!isDemo) shell.showItemInFolder(file)
  // Палитра «Из обоев» подстраивается под новые обои
  if (changed) updateWallpaperPalette(file)
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
  const ext = path.extname(filePaths[0]).toLowerCase()
  let dest = path.join(dir, `custom-${Date.now()}${ext}`)
  // JPG, PNG и BMP Windows ставит всегда, а WebP и GIF — не на каждой системе: перекодируем
  if (['.jpg', '.jpeg', '.png', '.bmp'].includes(ext)) fs.copyFileSync(filePaths[0], dest)
  else dest = await convert.toJpg(convertCtx(), filePaths[0], dest.replace(/\.[^.]+$/, '.jpg'))
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
  if (key === 'palette') return setPalette(value)
  if (key === 'autostart') return setAutostart(value)
  if (key === 'eco') {
    config.eco = !!value
    updatePower({})
  } else if (key === 'searchEngine') {
    if (!['yandex', 'google'].includes(value)) return
    config.searchEngine = value
  } else if (key === 'island') {
    config.island = !!value
    value ? islandWin.showInactive() : islandWin.hide()
  } else if (key === 'menubar') {
    config.menubar = !!value
    if (value) createMenubar()
    if (!value) destroyMenubar()
  } else if (key === 'dragshift') {
    // Принимаем только известные поля с допустимыми значениями
    const allowed = {
      enabled: (v) => typeof v === 'boolean',
      key: (v) => ['shift', 'ctrl', 'alt'].includes(v),
      output: (v) => ['beside', 'folder'].includes(v),
      quality: (v) => v >= 0.3 && v <= 1,
      targetKb: (v) => Number.isInteger(v) && v >= 50 && v <= 20480,
      dpi: (v) => [96, 150, 300].includes(v),
      sendTo: (v) => typeof v === 'boolean'
    }
    for (const [k, v] of Object.entries(value ?? {})) if (allowed[k]?.(v)) config.dragshift[k] = v
    applyDragshiftHook()
    ensureSendTo()
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
    { label: 'Эко-режим (меньше нагрузка)', type: 'checkbox', checked: !!config.eco, click: (item) => setSetting('eco', item.checked) },
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

// ---------- Конвертер (по мотивам DragShift) ----------
// Потащил файл, нажал Shift — под курсором круговое меню; бросил на сектор — рядом результат.
// Движок — lib/convert.js, меню — src/radial.*, уведомление — src/toast.*

let radialWin, toastWin
let radialMode = null
let radialGotDrag = false // файл уже долетел до меню
let radialWatch = null
let lastResult = null
const RADIAL_SIZE = 440
const TOAST_SIZE = { width: 400, height: 132 }
const TRIGGER_VK = { shift: 0x10, ctrl: 0x11, alt: 0x12 }

const convertCtx = () => ({ srcDir: SRC, webPreferences, settings: config.dragshift })

// Действия для меню; у «≤ размер» в подписи — лимит из настроек
function dragshiftActions(items) {
  const set = convert.actionsFor(items)
  const label = (a) => (a.id === 'compress-target' ? { ...a, label: `≤ ${config.dragshift.targetKb >= 1024 ? config.dragshift.targetKb / 1024 + ' МБ' : config.dragshift.targetKb + ' КБ'}` } : a)
  return { convert: set.convert.map(label), tools: set.tools.map(label) }
}

// Слежение за мышью и клавишей живёт в мосте (bridge.ps1); включаем или выключаем по настройке
function applyDragshiftHook() {
  if (!isWin) return
  if (config.dragshift.enabled) bridge.send(`hook ${TRIGGER_VK[config.dragshift.key] ?? 0x10}`)
  else bridge.send('hook-off')
}

async function createConverterWindows() {
  const overlayOptions = { frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false }
  radialWin = await shellHost.open('radial.html', null, { ...overlayOptions, width: RADIAL_SIZE, height: RADIAL_SIZE })
  radialWin.setAlwaysOnTop(true, 'screen-saver')
  // Меню, открытое щелчком, закрывается, если кликнуть мимо
  radialWin.on('blur', () => radialMode === 'click' && hideRadial())
  toastWin = await shellHost.open('toast.html', null, { ...overlayOptions, ...TOAST_SIZE, focusable: false })
  toastWin.setAlwaysOnTop(true, 'screen-saver')
}

function openRadial(point, { files: paths = null } = {}) {
  if (!radialWin) return
  const area = screen.getDisplayNearestPoint(point).bounds
  const half = RADIAL_SIZE / 2
  const x = Math.round(Math.min(Math.max(point.x - half, area.x), area.x + area.width - RADIAL_SIZE))
  const y = Math.round(Math.min(Math.max(point.y - half, area.y), area.y + area.height - RADIAL_SIZE))
  radialWin.setBounds({ x, y, width: RADIAL_SIZE, height: RADIAL_SIZE })
  radialMode = paths ? 'click' : 'drag'
  radialGotDrag = false
  const actions = paths ? dragshiftActions(paths.map(convert.itemOfPath)) : null
  radialWin.webContents.send('radial:open', { mode: radialMode, files: paths, actions })
  if (paths) {
    radialWin.show()
    radialWin.focus()
  } else {
    // Во время перетаскивания фокус не забираем — иначе Проводник может прервать перетаскивание
    radialWin.showInactive()
  }
}

function hideRadial() {
  radialMode = null
  clearInterval(radialWatch)
  radialWin?.hide()
}

// Как в оригинале: Shift + зажатая кнопка + сдвиг на 10 px — это может быть и не файл, а
// перетаскивание окна или выделение текста с Shift. Если курсор уходит, а файл до меню так
// и не долетел (≈0,75 с движения), — убираемся с дороги
function watchNoDrag(start) {
  clearInterval(radialWatch)
  let idle = 0
  radialWatch = setInterval(() => {
    if (radialMode !== 'drag' || radialGotDrag) return clearInterval(radialWatch)
    const p = screen.getCursorScreenPoint()
    if (Math.abs(p.x - start.x) + Math.abs(p.y - start.y) > 6 && ++idle > 15) hideRadial()
  }, 50)
}

function onDragshiftTrigger(msg) {
  // В игре на весь экран Shift + мышь — это бег и стрельба, а не перетаскивание файла
  if (!config.dragshift.enabled || power.fullscreen) return
  if (radialWin?.isVisible()) return
  const point = screen.screenToDipPoint({ x: msg.x, y: msg.y })
  openRadial(point)
  watchNoDrag(point)
}

function showToast(t) {
  if (!toastWin) return
  const { workArea } = screen.getPrimaryDisplay()
  toastWin.setBounds({
    x: workArea.x + workArea.width - TOAST_SIZE.width - 12,
    y: workArea.y + workArea.height - DOCK_HEIGHT - TOAST_SIZE.height,
    ...TOAST_SIZE
  })
  toastWin.webContents.send('toast:show', t)
  toastWin.showInactive()
}

// Миниатюра результата для уведомления (если это картинка, которую умеет nativeImage)
function thumbOf(p) {
  if (!p || !/\.(jpe?g|png)$/i.test(p)) return null
  const img = nativeImage.createFromPath(p)
  return img.isEmpty() ? null : img.resize({ width: 108 }).toDataURL()
}

// 1 файл, 2 файла, 5 файлов
function filesWord(n) {
  const d = n % 10
  const dd = n % 100
  return `${n} ${d === 1 && dd !== 11 ? 'файл' : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'файла' : 'файлов'}`
}

async function runConversion(actionId, paths, options) {
  hideRadial()
  // Инструменты с настройками (обрезка, пометки, пароль…) открывают своё окно
  if (convert.isWindowTool(actionId)) return openTool(actionId, paths)
  const what = paths.length > 1 ? filesWord(paths.length) : path.basename(paths[0])
  showToast({ state: 'busy', title: `${convert.labelOf(actionId)} · ${what}` })
  try {
    const res = await convert.run(convertCtx(), actionId, paths, options)
    lastResult = res
    const names = res.outputs.map((o) => path.basename(o))
    showToast({
      state: res.outputs.length ? 'done' : 'info',
      title: names.length > 1 ? `${filesWord(names.length)} · ${names[0]} …` : names[0] ?? what,
      note: res.note,
      thumb: thumbOf(res.outputs[0])
    })
    return res
  } catch (err) {
    console.error('Конвертер:', err)
    showToast({ state: 'error', title: `${convert.labelOf(actionId)} · ${what}`, note: err.message })
    return { error: err.message }
  }
}

// ---------- Окна инструментов ----------
// Обрезка, правка, пометки, «скрыть», фон, метаданные, сжатие, размер, пароль на PDF.
// Окно работает с картинкой само (canvas), а сюда присылает готовые байты — сохранить рядом

const toolWins = new Set()
const toolFiles = new Map() // какие файлы окну можно читать: id окна → пути
const TOOL_SIZE = {
  'tool-protect': { width: 460, height: 440, resizable: false },
  'tool-meta': { width: 600, height: 600, minWidth: 480, minHeight: 420 }
}

function openTool(id, paths) {
  const size = TOOL_SIZE[id] ?? { width: 1060, height: 720, minWidth: 780, minHeight: 540 }
  const query = { tool: id.slice('tool-'.length), files: JSON.stringify(paths), quality: String(config.dragshift.quality), target: String(config.dragshift.targetKb) }
  const win = appWindow('tool.html', query, size)
  const wcId = win.webContents.id
  toolFiles.set(wcId, new Set(paths))
  toolWins.add(win)
  win.on('closed', () => {
    toolWins.delete(win)
    toolFiles.delete(wcId)
  })
}

const toolAllowed = (e, p) => toolFiles.get(e.sender.id)?.has(p)

async function toolSave(src, suffix, ext, bytes) {
  const out = convert.saveEdited(config.dragshift, src, suffix, ext, bytes)
  lastResult = { outputs: [out] }
  showToast({ state: 'done', title: path.basename(out), note: `${suffix} · ${Math.round(bytes.length / 1024)} КБ`, thumb: thumbOf(out) })
  return out
}

async function toastAction(action) {
  const outputs = lastResult?.outputs ?? []
  if (action === 'hide') return toastWin?.hide()
  if (!outputs.length) return
  if (action === 'open') return outputs.length === 1 ? shell.openPath(outputs[0]) : shell.showItemInFolder(outputs[0])
  if (action === 'reveal') return shell.showItemInFolder(outputs[0])
  if (action === 'undo') {
    // Отменить = убрать созданное в корзину; оригинал и так не трогали
    for (const o of outputs) await shell.trashItem(o).catch(() => fs.rmSync(o, { force: true }))
    lastResult = null
    showToast({ state: 'undone', title: outputs.length > 1 ? `${filesWord(outputs.length)} в корзине` : `${path.basename(outputs[0])} — в корзине` })
  }
}

// Файлы после флага --dragshift (так их передаёт ярлык в «Отправить»)
function dragshiftArgs(argv) {
  const i = argv.indexOf('--dragshift')
  return i < 0 ? [] : argv.slice(i + 1).filter((a) => !a.startsWith('--') && fs.existsSync(a))
}

// Пункт «Отправить → Familiar — преобразовать» в контекстном меню Проводника
function ensureSendTo() {
  if (!isWin) return
  const link = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'SendTo', 'Familiar — преобразовать.lnk')
  try {
    if (!config.dragshift.sendTo) return fs.rmSync(link, { force: true })
    // В разработке exe — это electron.exe, и ему нужен путь к приложению
    const args = app.isPackaged ? '--dragshift' : `"${app.getAppPath()}" --dragshift`
    shell.writeShortcutLink(link, fs.existsSync(link) ? 'replace' : 'create', {
      target: process.execPath,
      args,
      description: 'Преобразовать файл в Familiar Lite',
      icon: process.execPath,
      iconIndex: 0
    })
  } catch (err) {
    console.error('Не получилось создать пункт «Отправить»:', err.message)
  }
}

// ---------- Таймер фокуса (Помодоро) ----------
// Идёт в главном процессе — окна только показывают; остров рисует обратный отсчёт

let focus = null // { endsAt, total, label }
let focusTimer = null

function startFocus(minutes, label = 'Фокус') {
  minutes = Math.max(1, Math.min(600, Math.round(minutes) || 25))
  clearTimeout(focusTimer)
  focus = { endsAt: Date.now() + minutes * 60000, total: minutes * 60000, label }
  focusTimer = setTimeout(finishFocus, minutes * 60000)
  broadcast('focus', focus)
  showToast({ state: 'info', title: `${label} · ${minutes} мин`, note: 'Отсчёт — в острове сверху. Остановить: «стоп» в Alt+Space' })
}

function stopFocus() {
  clearTimeout(focusTimer)
  focus = null
  broadcast('focus', null)
}

function finishFocus() {
  const label = focus?.label ?? 'Таймер'
  focus = null
  broadcast('focus', null)
  broadcast('focus-done', label)
  const rest = label === 'Перерыв' ? 'Пора за дело!' : 'Сделай перерыв: «перерыв» в Alt+Space'
  showToast({ state: 'info', title: `${label} — время вышло`, note: rest })
  if (Notification.isSupported()) new Notification({ title: `${label} — время вышло`, body: rest, silent: false }).show()
}

// ---------- Быстрые действия из поиска (Alt+Space) ----------

// Системные команды Windows. Опасные (выключить, перезагрузить, очистить корзину) — только после «Да»
const SYSTEM_COMMANDS = {
  lock: { file: 'rundll32.exe', args: ['user32.dll,LockWorkStation'] },
  sleep: { file: 'powershell.exe', args: ['-NoProfile', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"] },
  shutdown: { file: 'shutdown.exe', args: (m) => ['/s', '/t', String(m * 60)], confirm: (m) => (m ? `Выключить компьютер через ${m} мин?` : 'Выключить компьютер сейчас?') },
  restart: { file: 'shutdown.exe', args: ['/r', '/t', '0'], confirm: () => 'Перезагрузить компьютер сейчас?' },
  cancel: { file: 'shutdown.exe', args: ['/a'] },
  'empty-bin': { file: 'powershell.exe', args: ['-NoProfile', '-Command', 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue'], confirm: () => 'Очистить корзину? Файлы из неё удалятся навсегда.' }
}

async function runSystemCommand(cmd, minutes = 0) {
  const c = SYSTEM_COMMANDS[cmd]
  if (!c) return
  if (!isWin) return showToast({ state: 'info', title: 'Только на Windows', note: 'Эта команда работает в Windows' })
  if (c.confirm) {
    const { response } = await dialog.showMessageBox({ type: 'question', buttons: ['Да', 'Отмена'], defaultId: 1, cancelId: 1, title: 'Familiar', message: c.confirm(minutes) })
    if (response !== 0) return
  }
  const args = typeof c.args === 'function' ? c.args(minutes) : c.args
  spawn(c.file, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  if (cmd === 'shutdown' && minutes) showToast({ state: 'info', title: `Выключение через ${minutes} мин`, note: 'Передумал — «отмена» в Alt+Space' })
  if (cmd === 'cancel') showToast({ state: 'info', title: 'Выключение отменено' })
  if (cmd === 'empty-bin') showToast({ state: 'info', title: 'Корзина очищена' })
}

function quickAction(a) {
  if (!a || typeof a !== 'object') return
  if (a.type === 'copy' && typeof a.text === 'string') {
    clipboard.writeText(a.text.slice(0, 200))
    showToast({ state: 'info', title: `Скопировано: ${a.text.slice(0, 40)}` })
  } else if (a.type === 'focus') startFocus(Number(a.minutes), ['Фокус', 'Таймер', 'Перерыв'].includes(a.label) ? a.label : 'Таймер')
  else if (a.type === 'focus-stop') stopFocus()
  else if (a.type === 'eco') {
    setSetting('eco', !config.eco)
    showToast({ state: 'info', title: config.eco ? 'Эко-режим включён' : 'Эко-режим выключен', note: config.eco ? 'Вдвое меньше кадров — компьютер отдыхает' : 'Анимации снова на полной скорости' })
  } else if (a.type === 'theme') setTheme(nativeTheme.shouldUseDarkColors ? 'light' : 'dark')
  else if (a.type === 'media' && ['toggle', 'next', 'prev'].includes(a.cmd)) bridge.send(a.cmd)
  else if (a.type === 'system') runSystemCommand(a.cmd, Math.max(0, Math.min(600, Number(a.minutes) || 0)))
  else if (a.type === 'open') {
    if (a.what === 'settings') openSettings()
    if (a.what === 'files') openFiles()
    if (a.what === 'widgets') toggleWidgets()
  } else if (a.type === 'web' && typeof a.query === 'string') {
    // Адрес собираем здесь, из запроса, — окно не может подсунуть свою ссылку
    const q = encodeURIComponent(a.query.slice(0, 300))
    shell.openExternal(config.searchEngine === 'google' ? `https://www.google.com/search?q=${q}` : `https://yandex.ru/search/?text=${q}`)
  }
}

// Автозапуск вместе с Windows (в разработке electron.exe нужен путь к приложению)
function setAutostart(on) {
  if (!isWin) return
  app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] })
}
const getAutostart = () => (isWin ? app.getLoginItemSettings({ path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] }).openAtLogin : false)

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
      {
        label: 'Преобразовать…',
        enabled: !item.isDir && !!convert.kindOf(files.linkTarget(item.path)),
        click: () => openRadial(screen.getCursorScreenPoint(), { files: [files.linkTarget(item.path)] })
      },
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

  // Конвертер
  ipcMain.handle('dragshift:actions', (_e, mimes) => dragshiftActions((mimes ?? []).map(convert.itemOfMime)))
  ipcMain.handle('dragshift:run', (_e, actionId, paths, options) => runConversion(actionId, paths, options))
  ipcMain.on('dragshift:close', hideRadial)
  ipcMain.on('dragshift:got', () => (radialGotDrag = true))
  ipcMain.on('quick:action', (_e, a) => quickAction(a))
  ipcMain.handle('focus:get', () => focus)
  ipcMain.on('focus:start', (_e, minutes, label) => startFocus(Number(minutes), ['Фокус', 'Перерыв', 'Таймер'].includes(label) ? label : 'Фокус'))
  ipcMain.on('focus:stop', stopFocus)
  ipcMain.handle('autostart:get', getAutostart)
  // Данные виджетов (заметки, тренировки, расписание…): лежат в config.json, пишутся с задержкой
  ipcMain.handle('widget-data:get', (_e, name) => config.widgetData?.[String(name)] ?? null)
  ipcMain.handle('widget-data:set', (e, name, value) => {
    const json = JSON.stringify(value ?? null)
    if (json.length > 256 * 1024) return false // заметка на 256 КБ — уже не заметка
    config.widgetData ??= {}
    config.widgetData[String(name)] = JSON.parse(json)
    saveConfig({ quiet: true })
    // Другие окна с тем же виджетом (например, расписание в настройках) — пусть обновятся
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents !== e.sender && !w.isDestroyed()) w.webContents.send('widget-data', String(name), config.widgetData[String(name)])
    return true
  })
  // Палитра нужна окну синхронно, до первой отрисовки
  ipcMain.on('palette:get', (e) => (e.returnValue = paletteCss()))
  ipcMain.handle('palette:list', () => {
    const swatch = (p) => p && [p.dark['--solid'], p.dark['--text'], p.dark['--muted'], p.dark['--accent'], p.dark['--petal']]
    return { moon: swatch(palette.PRESETS.moon), nothing: swatch(palette.PRESETS.nothing), wallpaper: swatch(config.wallpaperPalette) }
  })
  ipcMain.handle('tool:read', (e, p) => {
    if (!toolAllowed(e, p)) return null
    const bytes = fs.readFileSync(p)
    return { path: p, name: path.basename(p), ext: path.extname(p).slice(1).toLowerCase(), size: bytes.length, bytes }
  })
  ipcMain.handle('tool:meta', async (e, p) => {
    if (!toolAllowed(e, p)) return null
    return convert.kindOf(p) === 'pdf' ? convert.pdfMeta(p) : convert.readMeta(fs.readFileSync(p))
  })
  ipcMain.handle('tool:save', (e, src, suffix, ext, bytes) => (toolAllowed(e, src) ? toolSave(src, suffix, ext, bytes) : null))
  ipcMain.handle('tool:run', (e, actionId, paths, options) => (paths.every((p) => toolAllowed(e, p)) ? runConversion(actionId, paths, options) : null))
  // Значок под курсором при перетаскивании: красная точка 24×24 в нашем стиле
  let dragIcon = null
  ipcMain.on('file:drag', (e, file) => {
    if (!dragIcon) {
      const n = 24
      const buf = Buffer.alloc(n * n * 4)
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const inside = Math.hypot(x - 11.5, y - 11.5) < 7
        buf.set(inside ? [0x2d, 0x2d, 0xff, 0xff] : [0, 0, 0, 0], (y * n + x) * 4) // BGRA
      }
      dragIcon = nativeImage.createFromBitmap(buf, { width: n, height: n })
    }
    if (fs.existsSync(file)) e.sender.startDrag({ file, icon: dragIcon })
  })
  ipcMain.on('dragshift:open', (_e, paths) => openRadial(screen.getCursorScreenPoint(), { files: paths }))
  ipcMain.handle('toast:action', (_e, action) => toastAction(action))

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
// Лишнее из Chromium: медиаклавиши он перехватывал бы себе (музыкой управляет Windows через
// мост), а «запасной» процесс страницы держит в памяти ещё ~30 МБ просто на всякий случай.
// Молодое поколение кучи V8 поменьше — тоже минус несколько мегабайт на процесс, без потерь в скорости
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService,SpareRendererForSitePerProcess')
app.commandLine.appendSwitch('js-flags', '--max-semi-space-size=1')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Второй запуск: «Отправить → Familiar — преобразовать» передаёт файлы, иначе — открыть поиск
  app.on('second-instance', (_e, argv) => {
    const sent = dragshiftArgs(argv)
    if (sent.length) openRadial(screen.getCursorScreenPoint(), { files: sent })
    else toggleLauncher()
  })

  app.whenReady().then(() => {
    config = loadConfig()
    nativeTheme.themeSource = config.theme
    seedCustomWidgets()
    registerIpc()
    enableLoopbackAudio()
    bridge = startBridge({ app, isDemo, onMessage: onBridgeMessage, onStart: applyDragshiftHook })

    watchPower()
    shellHost = createHost(SRC, webPreferences)
    widgetHost = createHost(SRC, webPreferences)
    if (config.menubar) createMenubar()
    createDock()
    createIsland()
    createLauncher()
    createConverterWindows().then(() => {
      // Запустили через «Отправить → …», когда оболочка ещё не работала
      const sent = dragshiftArgs(process.argv)
      if (sent.length) openRadial(screen.getCursorScreenPoint(), { files: sent })
    })
    ensureSendTo()
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
    // Музыка с клавиатуры из любой программы
    globalShortcut.register('Control+Alt+Space', () => bridge.send('toggle'))
    globalShortcut.register('Control+Alt+Right', () => bridge.send('next'))
    globalShortcut.register('Control+Alt+Left', () => bridge.send('prev'))

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
