// Мост между окнами (HTML) и главным процессом.
// Окна не имеют доступа к Node.js напрямую — только к этим функциям.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('familiar', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  onConfigChanged: (cb) => ipcRenderer.on('config-changed', (_e, c) => cb(c)),
  listApps: () => ipcRenderer.invoke('apps:list'),
  listFiles: () => ipcRenderer.invoke('files:list'),
  launch: (item) => ipcRenderer.invoke('launch', item),
  icon: (path) => ipcRenderer.invoke('icon', path),
  pin: (item) => ipcRenderer.invoke('dock:pin', item),
  reorder: (from, to) => ipcRenderer.invoke('dock:reorder', from, to),
  dockMenu: (index) => ipcRenderer.send('dock:menu', index),
  dockHover: (over) => ipcRenderer.send('dock:hover', over),
  pathForFile: (file) => webUtils.getPathForFile(file),
  toggleLauncher: () => ipcRenderer.send('launcher:toggle'),
  hideLauncher: () => ipcRenderer.send('launcher:hide'),
  onLauncherOpened: (cb) => ipcRenderer.on('launcher-opened', cb),
  setReminders: (r) => ipcRenderer.invoke('reminders:set', r),
  weather: () => ipcRenderer.invoke('weather')
})
