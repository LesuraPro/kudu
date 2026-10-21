// Ярлыки: содержимое папки Familiar значками, как на рабочем столе.
// Перетащи сюда файл или папку из Проводника — появится ярлык, оригинал останется на месте.
Widget.define('shortcuts', (card) => {
  const head = Widget.el('div', 'head')
  const label = Widget.el('div', 'label', 'Familiar')
  const openBtn = Widget.el('button', 'open', 'Файлы ↗')
  openBtn.addEventListener('click', () => window.familiar.openFiles())
  head.append(label, openBtn)
  const grid = Widget.el('div', 'grid')
  const hint = Widget.el('div', 'hint', 'Перетащи сюда файлы или папки')
  card.append(head, grid, hint)

  let selected = null

  function item(entry) {
    const el = Widget.el('div', 'item')
    el.tabIndex = 0
    const icon = Widget.el('div', 'icon')
    icon.textContent = entry.isDir ? '▦' : '▤'
    window.familiar.icon(entry.path).then((src) => {
      if (!src) return
      const img = Widget.el('img')
      img.src = src
      icon.replaceChildren(img)
    })
    const name = Widget.el('div', 'name', entry.name)
    if (entry.isLink) el.classList.add('link')
    el.append(icon, name)
    el.title = entry.name
    el.addEventListener('click', () => {
      selected?.classList.remove('selected')
      selected = el
      el.classList.add('selected')
    })
    el.addEventListener('dblclick', () => window.familiar.launch({ path: entry.path }))
    // Ярлык можно утащить в Проводник или другую программу; Shift по пути — конвертер
    el.draggable = true
    el.addEventListener('dragstart', (ev) => {
      ev.preventDefault()
      window.familiar.startDrag(entry.path)
    })
    el.addEventListener('keydown', (e) => e.key === 'Enter' && window.familiar.launch({ path: entry.path }))
    el.addEventListener('contextmenu', (e) => {
      // Своё меню вместо общего меню виджетов
      e.preventDefault()
      e.stopPropagation()
      window.familiar.shortcutMenu(entry)
    })
    return el
  }

  async function load() {
    const { entries } = await window.familiar.listFolder()
    grid.replaceChildren(...entries.map(item))
    hint.hidden = entries.length > 1
  }
  load()
  window.familiar.onFamiliarChanged(load)

  // Перетаскивание из Проводника
  grid.addEventListener('dragover', (e) => {
    e.preventDefault()
    card.classList.add('drop')
  })
  grid.addEventListener('dragleave', () => card.classList.remove('drop'))
  grid.addEventListener('drop', (e) => {
    e.preventDefault()
    card.classList.remove('drop')
    const paths = [...e.dataTransfer.files].map((f) => window.familiar.pathForFile(f)).filter(Boolean)
    if (paths.length) window.familiar.addShortcuts(paths).then(load)
  })
})
