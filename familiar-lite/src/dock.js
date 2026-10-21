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

function makeItem({ name, onClick, onMenu, system, letter }) {
  const el = document.createElement('div')
  el.className = 'item' + (system ? ' system' : '')
  const fallback = document.createElement('div')
  fallback.className = 'letter'
  fallback.textContent = letter ?? name.charAt(0).toUpperCase()
  const tip = document.createElement('div')
  tip.className = 'tip'
  tip.textContent = name
  el.append(fallback, tip)
  el.addEventListener('click', onClick)
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    onMenu()
  })
  return el
}

let dragFrom = null

function render(config) {
  dock.replaceChildren()

  config.pinned.forEach((app, i) => {
    const el = makeItem({
      name: app.name,
      onClick: () => window.familiar.launch(app),
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

  if (config.pinned.length) {
    const div = document.createElement('div')
    div.className = 'divider'
    dock.appendChild(div)
  }

  dock.appendChild(
    makeItem({ name: 'Поиск (Alt+Space)', letter: '⌕', system: true, onClick: () => window.familiar.toggleLauncher(), onMenu: () => window.familiar.dockMenu(-1) })
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

dock.addEventListener('mouseenter', () => window.familiar.captureMouse(true))
dock.addEventListener('mouseleave', () => {
  window.familiar.captureMouse(false)
  for (const el of dock.querySelectorAll('.item')) el.style.width = el.style.height = ''
})

// Перетащить файл/ярлык из Проводника прямо на док — он закрепится
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => {
  e.preventDefault()
  for (const f of e.dataTransfer.files) {
    const path = window.familiar.pathForFile(f)
    if (path) window.familiar.pin({ name: f.name.replace(/\.(lnk|exe|url)$/i, ''), path })
  }
})

window.familiar.getConfig().then(render)
window.familiar.onConfigChanged(render)
