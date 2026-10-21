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
  cursor: () => ipcRenderer.invoke('cursor:get')
})
