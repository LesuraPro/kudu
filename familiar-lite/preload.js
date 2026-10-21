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
  sysinfo: () => ipcRenderer.invoke('sysinfo'),
  pin: (item) => ipcRenderer.invoke('dock:pin', item),
  reorder: (from, to) => ipcRenderer.invoke('dock:reorder', from, to),
  dockMenu: (index) => ipcRenderer.send('dock:menu', index),
  captureMouse: (over) => ipcRenderer.send('mouse:capture', over),
  pathForFile: (file) => webUtils.getPathForFile(file),
  toggleLauncher: () => ipcRenderer.send('launcher:toggle'),
  toggleWidgets: () => ipcRenderer.send('widgets:toggle'),
  hideLauncher: () => ipcRenderer.send('launcher:hide'),
  onLauncherOpened: (cb) => ipcRenderer.on('launcher-opened', cb),
  setReminders: (r) => ipcRenderer.invoke('reminders:set', r),
  weather: () => ipcRenderer.invoke('weather'),
  getMedia: () => ipcRenderer.invoke('media:get'),
  onMedia: (cb) => ipcRenderer.on('media', (_e, m) => cb(m)),
  mediaCmd: (cmd) => ipcRenderer.send('media:cmd', cmd)
})
