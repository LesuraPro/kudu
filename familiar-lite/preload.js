// Мост между окнами (HTML) и главным процессом.
// Окна не имеют доступа к Node.js напрямую — только к этим функциям.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, data) => cb(data))

contextBridge.exposeInMainWorld('familiar', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  onConfigChanged: on('config-changed'),
  listApps: () => ipcRenderer.invoke('apps:list'),
  listFiles: () => ipcRenderer.invoke('files:list'),
  listGames: () => ipcRenderer.invoke('games:list'),
  gameCover: (id) => ipcRenderer.invoke('game:cover', id),
  launch: (item) => ipcRenderer.invoke('launch', item),
  icon: (path) => ipcRenderer.invoke('icon', path),
  sysinfo: () => ipcRenderer.invoke('sysinfo'),

  // Док и открытые окна
  getDock: () => ipcRenderer.invoke('dock:get'),
  onDock: on('dock'),
  focusWindow: (hwnds) => ipcRenderer.send('window:focus', hwnds),
  getForeground: () => ipcRenderer.invoke('foreground:get'),
  onForeground: on('foreground'),
  pin: (item) => ipcRenderer.invoke('dock:pin', item),
  reorder: (from, to) => ipcRenderer.invoke('dock:reorder', from, to),
  dockMenu: (index, running) => ipcRenderer.send('dock:menu', index, running),
  menubarMenu: (name, x) => ipcRenderer.send('menubar:menu', name, x),
  captureMouse: (over) => ipcRenderer.send('mouse:capture', over),
  expandDock: (on) => ipcRenderer.invoke('dock:expand', on),
  pathForFile: (file) => webUtils.getPathForFile(file),

  toggleLauncher: () => ipcRenderer.send('launcher:toggle'),
  toggleWidgets: () => ipcRenderer.send('widgets:toggle'),
  toggleTheme: () => ipcRenderer.send('theme:toggle'),
  hideLauncher: () => ipcRenderer.send('launcher:hide'),
  onLauncherOpened: on('launcher-opened'),
  setReminders: (r) => ipcRenderer.invoke('reminders:set', r),
  weather: () => ipcRenderer.invoke('weather'),

  // Музыка, нагрузка, устройства, курсор
  getMedia: () => ipcRenderer.invoke('media:get'),
  onMedia: on('media'),
  mediaCmd: (cmd) => ipcRenderer.send('media:cmd', cmd),
  getStats: () => ipcRenderer.invoke('stats:get'),
  onStats: on('stats'),
  getDevices: () => ipcRenderer.invoke('devices:get'),
  onDevices: on('devices'),
  cursor: () => ipcRenderer.invoke('cursor:get'),
  getPower: () => ipcRenderer.invoke('power:get'),
  onPower: on('power'),

  // Папка Familiar, «Ярлыки», «Файлы»
  places: () => ipcRenderer.invoke('places'),
  listFolder: (dir) => ipcRenderer.invoke('folder:list', dir),
  addShortcuts: (paths) => ipcRenderer.invoke('shortcut:add', paths),
  shortcutMenu: (item) => ipcRenderer.send('shortcut:menu', item),
  reveal: (path) => ipcRenderer.send('file:reveal', path),
  openFiles: (dir) => ipcRenderer.send('files:open', dir),
  onFamiliarChanged: on('familiar-changed'),
  onFilesGoto: on('files:goto'),

  // Настройки, профили, обои
  openSettings: (page) => ipcRenderer.send('settings:open', page),
  onSettingsPage: on('settings:page'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  listWidgets: () => ipcRenderer.invoke('widgets:list'),
  setWidget: (name, enabled) => ipcRenderer.invoke('widgets:set', name, enabled),
  resetLayout: () => ipcRenderer.invoke('widgets:reset'),
  openWidgetsFolder: () => ipcRenderer.send('widgets:folder'),
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  switchProfile: (id) => ipcRenderer.invoke('profiles:switch', id),
  createProfile: (name) => ipcRenderer.invoke('profiles:create', name),
  removeProfile: (id) => ipcRenderer.invoke('profiles:remove', id),
  renameProfile: (id, name) => ipcRenderer.invoke('profiles:rename', id, name),
  chooseProfilePhoto: (id) => ipcRenderer.invoke('profiles:photo', id),
  clearProfilePhoto: (id) => ipcRenderer.invoke('profiles:photo-clear', id),
  listWallpapers: () => ipcRenderer.invoke('wallpapers:list'),
  listPalettes: () => ipcRenderer.invoke('palette:list'),
  applyWallpaper: (style) => ipcRenderer.invoke('wallpaper:apply', style),
  chooseWallpaper: () => ipcRenderer.invoke('wallpaper:choose'),
  searchCity: (q) => ipcRenderer.invoke('geo:search', q),
  closeWindow: () => ipcRenderer.send('window:close'),
  quit: () => ipcRenderer.send('app:quit'),

  // Конвертер в духе DragShift: рабочее окно, круговое меню, уведомление о результате
  onJob: on('convert:job'),
  jobDone: (id, result) => ipcRenderer.send('convert:done', id, result),
  workerReady: () => ipcRenderer.send('convert:ready'),
  dragshiftActions: (kinds) => ipcRenderer.invoke('dragshift:actions', kinds),
  dragshiftKinds: (paths) => ipcRenderer.invoke('dragshift:kinds', paths),
  dragshiftRun: (actionId, paths, options) => ipcRenderer.invoke('dragshift:run', actionId, paths, options),
  dragshiftClose: () => ipcRenderer.send('dragshift:close'),
  dragshiftGot: () => ipcRenderer.send('dragshift:got'),
  // Окна инструментов
  toolRead: (p) => ipcRenderer.invoke('tool:read', p),
  toolMeta: (p) => ipcRenderer.invoke('tool:meta', p),
  toolSave: (src, suffix, ext, bytes) => ipcRenderer.invoke('tool:save', src, suffix, ext, bytes),
  toolRun: (actionId, paths, options) => ipcRenderer.invoke('tool:run', actionId, paths, options),
  convertFiles: (paths) => ipcRenderer.send('dragshift:open', paths),
  // Начать системное перетаскивание файла из нашего окна (в Проводник, в другие программы, в конвертер)
  startDrag: (path) => ipcRenderer.send('file:drag', path),
  onRadialOpen: on('radial:open'),
  onRadialToggle: on('radial:toggle'),
  onToast: on('toast:show'),
  toastAction: (action) => ipcRenderer.invoke('toast:action', action)
})

// ---------- Палитра оформления ----------
// Цвета (lib/palette.js) кладём отдельным <style> поверх theme.css. Берём синхронно, сразу
// при загрузке: окно не должно мигнуть палитрой по умолчанию. preload видит тот же DOM,
// что и страница, а событие «familiar-palette» говорит рисовалкам сбросить кэш цветов
let paletteCss = ''
try {
  paletteCss = ipcRenderer.sendSync('palette:get') ?? ''
} catch {}
function applyPalette(css) {
  paletteCss = css
  // Служебным окнам без интерфейса (хозяева, рабочее окно конвертера, генератор обоев) палитра не нужна
  if (!document.querySelector('link[href$="theme.css"]')) return
  let style = document.getElementById('familiar-palette')
  if (!style) {
    style = document.createElement('style')
    style.id = 'familiar-palette'
    ;(document.head ?? document.documentElement).appendChild(style)
  }
  style.textContent = css
  window.dispatchEvent(new Event('familiar-palette'))
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => applyPalette(paletteCss))
else applyPalette(paletteCss)
ipcRenderer.on('palette', (_e, css) => applyPalette(css))
