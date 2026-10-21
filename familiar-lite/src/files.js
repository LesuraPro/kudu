// «Файлы»: просмотр папок и открытие файлов. Перемещение, переименование и удаление
// — в Проводнике (кнопка внизу), как и в оригинальном Familiar.
const $ = (id) => document.getElementById(id)
const main = $('main')

let current = null
let entries = []
let selected = -1
const history = []
let historyPos = -1
let view = 'grid'
try {
  view = localStorage.filesView === 'list' ? 'list' : 'grid'
} catch {}

const iconCache = new Map()
const icon = (p) => {
  if (!iconCache.has(p)) iconCache.set(p, window.familiar.icon(p))
  return iconCache.get(p)
}

function fmtSize(b) {
  if (b == null) return ''
  const units = ['Б', 'КБ', 'МБ', 'ГБ']
  let i = 0
  while (b >= 1024 && i < units.length - 1) (b /= 1024), i++
  return `${b < 10 && i ? b.toFixed(1) : Math.round(b)} ${units[i]}`
}

// «21 окт., 18:46»; год — только если не текущий
function fmtDate(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return sameYear
    ? d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ---------- Навигация ----------

async function go(dir, { push = true } = {}) {
  const res = await window.familiar.listFolder(dir)
  current = res
  entries = res.entries
  selected = -1
  $('q').value = ''
  if (push) {
    history.splice(historyPos + 1)
    history.push(res.path)
    historyPos = history.length - 1
  }
  render()
  renderCrumbs()
  highlightPlace()
  $('back').disabled = historyPos <= 0
  $('forward').disabled = historyPos >= history.length - 1
  $('up').disabled = !res.parent
  $('status').textContent = res.error ?? `${entries.length} объектов`
}

function open(entry) {
  if (entry.isDir) go(entry.path)
  else window.familiar.launch({ path: entry.path })
}

$('back').addEventListener('click', () => historyPos > 0 && go(history[--historyPos], { push: false }))
$('forward').addEventListener('click', () => historyPos < history.length - 1 && go(history[++historyPos], { push: false }))
$('up').addEventListener('click', () => current?.parent && go(current.parent))
$('explorer').addEventListener('click', () => current && window.familiar.launch({ path: current.path }))

// ---------- Отрисовка ----------

function renderCrumbs() {
  const sep = current.path.includes('\\') ? '\\' : '/'
  const parts = current.path.split(sep).filter(Boolean)
  const crumbs = []
  let acc = current.path.startsWith(sep) ? sep : ''
  parts.forEach((part, i) => {
    acc += (i === 0 || acc.endsWith(sep) ? '' : sep) + part
    // «C:» без слеша — это текущая папка диска, а не корень
    const target = /^[a-z]:$/i.test(acc) ? acc + sep : acc
    const b = document.createElement('button')
    b.textContent = part
    b.addEventListener('click', () => go(target))
    if (i) crumbs.push(Object.assign(document.createElement('span'), { textContent: '›' }))
    crumbs.push(b)
  })
  $('crumbs').replaceChildren(...crumbs.slice(-9))
}

function render() {
  const q = $('q').value.trim().toLowerCase()
  const shown = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries
  main.className = view
  $('gridBtn').classList.toggle('active', view === 'grid')
  $('listBtn').classList.toggle('active', view === 'list')
  if (!shown.length) {
    main.replaceChildren(Object.assign(document.createElement('div'), { className: 'empty', textContent: q ? 'Ничего не нашлось' : 'Папка пуста' }))
    return
  }
  main.replaceChildren(
    ...shown.map((e, i) => {
      const el = document.createElement('div')
      el.className = 'entry' + (e.isLink ? ' link' : '') + (entries.indexOf(e) === selected ? ' selected' : '')
      // Появление «лесенкой»
      el.style.animationDelay = `${Math.min(i, 30) * 12}ms`
      const ic = document.createElement('div')
      ic.className = 'icon'
      ic.textContent = e.isDir ? '▦' : '▤'
      icon(e.path).then((src) => {
        if (!src) return
        const img = document.createElement('img')
        img.src = src
        ic.replaceChildren(img)
      })
      const name = document.createElement('div')
      name.className = 'name'
      name.textContent = e.name
      const size = Object.assign(document.createElement('div'), { className: 'meta', textContent: e.isDir ? 'папка' : fmtSize(e.size) })
      const date = Object.assign(document.createElement('div'), { className: 'meta', textContent: fmtDate(e.modified) })
      el.append(ic, name, size, date)
      el.title = e.name
      el.addEventListener('click', () => select(entries.indexOf(e)))
      el.addEventListener('dblclick', () => open(e))
      // Файл можно утащить в Проводник или другую программу; Shift по пути — конвертер
      el.draggable = true
      el.addEventListener('dragstart', (ev) => {
        ev.preventDefault()
        window.familiar.startDrag(e.path)
      })
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault()
        select(entries.indexOf(e))
        window.familiar.shortcutMenu(e)
      })
      return el
    })
  )
}

function select(i) {
  selected = i
  for (const el of main.querySelectorAll('.entry.selected')) el.classList.remove('selected')
  const q = $('q').value.trim().toLowerCase()
  const shown = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries
  const idx = shown.indexOf(entries[i])
  main.children[idx]?.classList.add('selected')
  main.children[idx]?.scrollIntoView({ block: 'nearest' })
}

$('q').addEventListener('input', render)
$('gridBtn').addEventListener('click', () => setView('grid'))
$('listBtn').addEventListener('click', () => setView('list'))
function setView(v) {
  view = v
  try {
    localStorage.filesView = v
  } catch {}
  render()
}

// ---------- Клавиатура ----------

document.addEventListener('keydown', (e) => {
  if (e.target === $('q') && !['Enter', 'ArrowDown', 'Escape'].includes(e.key)) return
  if (e.altKey && e.key === 'ArrowLeft') return $('back').click()
  if (e.altKey && e.key === 'ArrowRight') return $('forward').click()
  if (e.key === 'Backspace') return $('up').click()
  if (e.key === 'Escape') return ($('q').value = ''), render()
  if (e.key === 'Enter' && entries[selected]) return open(entries[selected])
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') select(Math.min(entries.length - 1, selected + 1))
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') select(Math.max(0, selected - 1))
})

// ---------- Места ----------

async function loadPlaces() {
  const places = await window.familiar.places()
  $('places').replaceChildren(
    ...places.map((p) => {
      const b = document.createElement('button')
      b.textContent = p.name
      b.dataset.path = p.path
      b.addEventListener('click', () => go(p.path))
      return b
    })
  )
  highlightPlace()
}

function highlightPlace() {
  for (const b of $('places').children) b.classList.toggle('active', b.dataset.path === current?.path)
}

window.familiar.onFilesGoto((dir) => go(dir))
window.familiar.onFamiliarChanged(() => current && go(current.path, { push: false }))

loadPlaces()
go(new URLSearchParams(location.search).get('dir') || undefined)
