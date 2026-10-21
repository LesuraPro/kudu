const q = document.getElementById('q')
const list = document.getElementById('list')

let items = []
let results = []
let active = 0
const iconCache = new Map()

// Простой нечёткий поиск: совпадение с начала слова важнее, чем в середине
function score(name, query) {
  const n = name.toLowerCase()
  if (n.startsWith(query)) return 3
  if (n.split(/[\s\-_.]+/).some((w) => w.startsWith(query))) return 2
  if (n.includes(query)) return 1
  return 0
}

function search() {
  const query = q.value.trim().toLowerCase()
  results = query
    ? items
        .map((it) => ({ it, s: score(it.name, query) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s || a.it.name.length - b.it.name.length)
        .slice(0, 30)
        .map((r) => r.it)
    : []
  active = 0
  render()
}

// Название с подсвеченным совпадением: «Te[ле]грам»
function highlighted(name, query) {
  const el = document.createElement('div')
  el.className = 'name'
  const i = query ? name.toLowerCase().indexOf(query) : -1
  if (i < 0) {
    el.textContent = name
    return el
  }
  const mark = document.createElement('mark')
  mark.textContent = name.slice(i, i + query.length)
  el.append(name.slice(0, i), mark, name.slice(i + query.length))
  return el
}

function render() {
  const query = q.value.trim().toLowerCase()
  if (query && !results.length) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = `Ничего не нашлось по «${q.value.trim()}»`
    list.replaceChildren(empty)
    return
  }
  list.replaceChildren(
    ...results.map((it, i) => {
      const row = document.createElement('div')
      row.className = 'row' + (i === active ? ' active' : '')
      const ph = document.createElement('div')
      ph.className = 'ph'
      const name = highlighted(it.name, query)
      const kind = document.createElement('div')
      kind.className = 'kind'
      kind.textContent = it.store ? `Игра · ${it.store}` : it.isFile ? 'Файл' : 'Приложение'
      row.append(ph, name, kind)
      row.addEventListener('click', () => open(it))
      // Подсветку при наведении переключаем классом, не перестраивая весь список
      row.addEventListener('mousemove', () => setActive(i, false))
      loadIcon(it).then((src) => {
        if (!src) return
        const img = document.createElement('img')
        img.src = src
        ph.replaceWith(img)
      })
      return row
    })
  )
  list.children[active]?.scrollIntoView({ block: 'nearest' })
}

function setActive(i, scroll = true) {
  if (i === active) return
  list.children[active]?.classList.remove('active')
  active = i
  list.children[active]?.classList.add('active')
  if (scroll) list.children[active]?.scrollIntoView({ block: 'nearest' })
}

// У игр вместо иконки — обложка из кэша Steam
function loadIcon(it) {
  if (!iconCache.has(it.path)) iconCache.set(it.path, it.store ? window.familiar.gameCover(it.id) : window.familiar.icon(it.path))
  return iconCache.get(it.path)
}

function open(it) {
  window.familiar.launch(it)
  window.familiar.hideLauncher()
}

q.addEventListener('input', search)
q.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') return window.familiar.hideLauncher()
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!results.length) return
    setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length)
  }
  if (e.key === 'Enter' && results[active]) {
    if (e.ctrlKey) {
      window.familiar.pin(results[active])
      window.familiar.hideLauncher()
    } else {
      open(results[active])
    }
  }
})

async function reload() {
  const [apps, games, files] = await Promise.all([window.familiar.listApps(), window.familiar.listGames(), window.familiar.listFiles()])
  items = [...apps, ...games, ...files]
}

const box = document.getElementById('box')

window.familiar.onLauncherOpened(async () => {
  q.value = ''
  results = []
  render()
  q.focus()
  // Перезапуск анимации появления
  box.classList.remove('show')
  void box.offsetWidth
  box.classList.add('show')
  await reload()
})

reload()
