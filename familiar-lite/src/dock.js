const dock = document.getElementById('dock')
const BASE = 52
const MAX = 80 // размер иконки прямо под курсором
const RANGE = 140 // на каком расстоянии от курсора иконки ещё растут

// Подменяем букву-заглушку настоящей иконкой приложения, если она есть
async function iconFor(item, el) {
  const data = await window.familiar.icon(item.path)
  if (data) {
    const img = document.createElement('img')
    img.src = data
    el.querySelector('.letter').replaceWith(img)
  }
}

// Пока иконка не загрузилась (или её нет, как у ms-settings:) — понятный значок вместо буквы
function fallbackLetter(app) {
  if (app.isDir) return '▦'
  if (/^ms-settings:/i.test(app.path)) return '⚙'
  if (/^(steam|com\.epicgames)/i.test(app.path)) return '▶'
  if (/^https?:/i.test(app.path)) return '◎'
  return app.name.charAt(0).toUpperCase()
}

function makeItem({ name, onClick, onMenu, system, letter, hwnds = [], foreground }) {
  const el = document.createElement('div')
  el.className = 'item' + (system ? ' system' : '')
  const fallback = document.createElement('div')
  fallback.className = 'letter'
  fallback.textContent = letter ?? name.charAt(0).toUpperCase()
  const tip = document.createElement('div')
  tip.className = 'tip'
  tip.textContent = name
  el.append(fallback, tip)
  // Точка под запущенным приложением, красная чёрточка — под активным
  if (hwnds.length) {
    const run = document.createElement('i')
    run.className = 'run' + (hwnds.includes(foreground) ? ' front' : '')
    el.appendChild(run)
  }
  el.addEventListener('click', onClick)
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    onMenu()
  })
  return el
}

const divider = () => Object.assign(document.createElement('div'), { className: 'divider' })

let dragFrom = null

function render({ pinned, running, foreground }) {
  dock.replaceChildren()

  pinned.forEach((app, i) => {
    const el = makeItem({
      name: app.name,
      letter: fallbackLetter(app),
      hwnds: app.hwnds,
      foreground,
      // Папка — раскрываем «веер»; уже запущено — переключаемся на окно; иначе запускаем
      onClick: () =>
        app.isDir ? toggleStack(app, el) : app.hwnds.length ? window.familiar.focusWindow(app.hwnds) : window.familiar.launch(app),
      onMenu: () => window.familiar.dockMenu(i)
    })
    iconFor(app, el)

    // Перетаскивание для смены порядка
    el.draggable = true
    el.addEventListener('dragstart', () => (dragFrom = i))
    el.addEventListener('dragover', (e) => {
      e.preventDefault()
      el.classList.add('drop-target')
    })
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'))
    el.addEventListener('drop', () => {
      el.classList.remove('drop-target')
      if (dragFrom !== null && dragFrom !== i) window.familiar.reorder(dragFrom, i)
      dragFrom = null
    })
    dock.appendChild(el)
  })

  // Запущенные, но не закреплённые — после разделителя, как в macOS
  if (running.length) {
    if (pinned.length) dock.appendChild(divider())
    for (const app of running) {
      const el = makeItem({
        name: app.name,
        hwnds: app.hwnds,
        foreground,
        onClick: () => window.familiar.focusWindow(app.hwnds),
        onMenu: () => window.familiar.dockMenu(-1, { name: app.name, path: app.path })
      })
      iconFor(app, el)
      dock.appendChild(el)
    }
  }

  if (pinned.length || running.length) dock.appendChild(divider())

  dock.appendChild(
    makeItem({
      name: 'Поиск (Alt+Space)',
      letter: '⌕',
      system: true,
      onClick: () => window.familiar.toggleLauncher(),
      onMenu: () => window.familiar.dockMenu(-1)
    })
  )
}

// Эффект «линзы»: размер иконки зависит от расстояния до курсора
dock.addEventListener('mousemove', (e) => {
  for (const el of dock.querySelectorAll('.item')) {
    const r = el.getBoundingClientRect()
    const dist = Math.abs(e.clientX - (r.left + r.width / 2))
    const size = BASE + (MAX - BASE) * Math.max(0, 1 - dist / RANGE)
    el.style.width = el.style.height = size + 'px'
  }
})

// Окно ловит клики, пока мышь над доком или над открытым «веером»
let overDock = false
let overStack = false
let closeTimer
function updateCapture() {
  window.familiar.captureMouse(overDock || overStack)
  clearTimeout(closeTimer)
  if (!overDock && !overStack && stackFor) closeTimer = setTimeout(closeStack, 500)
}

dock.addEventListener('mouseenter', () => ((overDock = true), updateCapture()))
dock.addEventListener('mouseleave', () => {
  overDock = false
  updateCapture()
  for (const el of dock.querySelectorAll('.item')) el.style.width = el.style.height = ''
})

// ---------- «Веер» закреплённой папки ----------

const stack = document.getElementById('stack')
const STACK_LIMIT = 15
let stackFor = null

stack.addEventListener('mouseenter', () => ((overStack = true), updateCapture()))
stack.addEventListener('mouseleave', () => ((overStack = false), updateCapture()))

function closeStack() {
  stackFor = null
  stack.classList.remove('open')
  // Окно дока сжимаем обратно, когда «веер» доиграл анимацию закрытия
  setTimeout(() => !stackFor && window.familiar.expandDock(false), 450)
}

// Дождаться, пока окно реально поменяет размер (или 150 мс, если размер уже тот)
function windowResized() {
  return new Promise((resolve) => {
    const done = () => (window.removeEventListener('resize', done), resolve())
    window.addEventListener('resize', done)
    setTimeout(done, 150)
  })
}

async function toggleStack(app, anchor) {
  if (stackFor === app.path) return closeStack()
  stackFor = app.path
  const resized = windowResized()
  const [{ entries, path }] = await Promise.all([window.familiar.listFolder(app.path), window.familiar.expandDock(true)])
  await resized

  const head = document.createElement('div')
  head.className = 'stack-head'
  const title = document.createElement('span')
  title.textContent = app.name
  const open = document.createElement('button')
  open.textContent = 'В «Файлах» ↗'
  open.addEventListener('click', () => (window.familiar.openFiles(path), closeStack()))
  head.append(title, open)

  const grid = document.createElement('div')
  grid.className = 'stack-grid'
  entries.slice(0, STACK_LIMIT).forEach((entry, i) => {
    const el = document.createElement('button')
    el.className = 'stack-item'
    // Появляются по очереди, снизу вверх — как будто вылетают из иконки
    el.style.animationDelay = `${(STACK_LIMIT - i) * 14}ms`
    const icon = document.createElement('div')
    icon.className = 'stack-icon'
    icon.textContent = entry.isDir ? '▦' : '▤'
    window.familiar.icon(entry.path).then((src) => {
      if (!src) return
      const img = document.createElement('img')
      img.src = src
      icon.replaceChildren(img)
    })
    const name = document.createElement('span')
    name.textContent = entry.name
    el.append(icon, name)
    el.title = entry.name
    el.addEventListener('click', () => {
      if (entry.isDir) window.familiar.openFiles(entry.path)
      else window.familiar.launch({ path: entry.path })
      closeStack()
    })
    grid.appendChild(el)
  })
  if (!entries.length) grid.append(Object.assign(document.createElement('div'), { className: 'stack-empty', textContent: 'Папка пуста' }))
  const more = entries.length > STACK_LIMIT ? [Object.assign(document.createElement('div'), { className: 'stack-more', textContent: `и ещё ${entries.length - STACK_LIMIT}…` })] : []

  stack.replaceChildren(head, grid, ...more)

  // Ставим «веер» над иконкой папки, не вылезая за края экрана
  const r = anchor.getBoundingClientRect()
  const width = stack.offsetWidth || 380
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left + r.width / 2 - width / 2))
  stack.style.left = `${left}px`
  stack.style.bottom = `${window.innerHeight - r.top + 14}px`
  stack.style.setProperty('--arrow', `${r.left + r.width / 2 - left}px`)
  stack.classList.remove('open')
  void stack.offsetWidth // перезапуск анимации
  stack.classList.add('open')
}

// Перетащить файл/ярлык из Проводника прямо на док — он закрепится
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => {
  e.preventDefault()
  for (const f of e.dataTransfer.files) {
    const path = window.familiar.pathForFile(f)
    if (path) window.familiar.pin({ name: f.name.replace(/\.(lnk|exe|url)$/i, ''), path })
  }
})

window.familiar.getDock().then(render)
window.familiar.onDock(render)
