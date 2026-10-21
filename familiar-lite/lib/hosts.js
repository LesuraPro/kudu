// Окна-«хозяева». Обычно каждое окно Electron — отдельный процесс (~30 МБ памяти).
// Но окна, открытые через window.open из одной страницы, Chromium селит в процесс
// открывшего. Поэтому невидимое окно-хозяин открывает все встроенные окна группы:
// десяток виджетов живёт в одном процессе вместо десяти.
const path = require('path')
const { BrowserWindow } = require('electron')

// Имена окон должны быть уникальны на всё приложение: window.open с уже занятым
// именем не создаёт новое окно, а перезагружает старое (даже у другого хозяина)
let seq = 0

function createHost(srcDir, webPreferences) {
  const host = new BrowserWindow({ show: false, width: 100, height: 100, webPreferences })
  // Каждому открываемому окну — уникальное имя, по нему находим его настройки
  const pending = new Map()

  host.webContents.setWindowOpenHandler(({ frameName }) => {
    const job = pending.get(frameName)
    // Открывать окна разрешено только нам самим
    if (!job) return { action: 'deny' }
    return { action: 'allow', overrideBrowserWindowOptions: { ...job.options, webPreferences } }
  })

  host.webContents.on('did-create-window', (win, { frameName }) => {
    const job = pending.get(frameName)
    if (!job) return
    pending.delete(frameName)
    job.resolve(win)
  })

  const ready = host.loadFile(path.join(srcDir, 'host.html'))

  return {
    // Открыть страницу из src/ как отдельное окно в процессе хозяина
    async open(file, query, options) {
      await ready
      const name = `win${++seq}`
      const url = query ? `${file}?${new URLSearchParams(query)}` : file
      const created = new Promise((resolve) => pending.set(name, { options, resolve }))
      await host.webContents.executeJavaScript(`void window.open(${JSON.stringify(url)}, ${JSON.stringify(name)})`)
      return created
    },
    window: host
  }
}

module.exports = { createHost }
