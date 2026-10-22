// Круговое меню конвертера. Два режима:
//  drag  — файл тащат прямо сейчас (Shift во время перетаскивания): бросаешь на сектор — готово;
//  click — открыли через «Преобразовать…» или «Отправить → Familiar»: щёлкаешь по сектору.
// Повторный Shift (или Tab) переключает «Конвертацию» и «Инструменты».
const svg = document.getElementById('ring')
const NS = 'http://www.w3.org/2000/svg'
const C = 210 // центр
const R_OUT = 200
const R_IN = 84

let mode = null // 'drag' | 'click'
let files = null // пути — известны в режиме click и после броска
let actions = { convert: [], tools: [] }
let ring = 'convert'
let hot = -1 // индекс подсвеченного сектора, -2 — центр
let kindsKey = ''

// Иконки инструментов 5×5 точек; у форматов (JPG, PDF…) вместо иконки — само название
const ICONS = {
  compress: ['#...#', '.#.#.', '.....', '.#.#.', '#...#'],
  'compress-target': ['...#.', '..#..', '.#...', '..#..', '...#.'],
  resize: ['#####', '#...#', '#.#.#', '#...#', '#####'],
  square: ['.#...', '#####', '.#.#.', '.####', '...#.'],
  enhance: ['..#..', '..#..', '##.##', '..#..', '..#..'],
  gray: ['.###.', '##..#', '##..#', '##..#', '.###.'],
  rotate: ['.###.', '#...#', '#..##', '#....', '.###.'],
  'pdf-rotate': ['.###.', '#...#', '#..##', '#....', '.###.'],
  clean: ['.###.', '#.#.#', '.###.', '..#..', '..#..'],
  'pdf-split': ['##.##', '##.##', '##.##', '##.##', '##.##'],
  merge: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
  'tool-compress': ['#...#', '.#.#.', '.....', '.#.#.', '#...#'],
  'tool-resize': ['###..', '#....', '#.#.#', '....#', '..###'],
  'tool-crop': ['.#...', '#####', '.#.#.', '.####', '...#.'],
  'tool-edit': ['..#..', '#.#.#', '.###.', '#.#.#', '..#..'],
  'tool-annotate': ['....#', '...#.', '..#..', '.#...', '#....'],
  'tool-redact': ['#####', '#####', '.....', '#####', '#####'],
  'tool-bg': ['#####', '#...#', '#.#.#', '#...#', '#####'],
  'tool-meta': ['..#..', '.....', '..#..', '..#..', '..#..'],
  'tool-protect': ['.###.', '.#.#.', '#####', '##.##', '#####'],
  'pdf-compress': ['#...#', '.#.#.', '.....', '.#.#.', '#...#'],
  'pdf-images': ['#####', '#...#', '#.#.#', '##.##', '#####']
}

const el = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  return e
}

// Сектор кольца от угла a0 до a1 (радианы, 0 — вверх, по часовой)
function slicePath(a0, a1, gap = 0.035) {
  const p = (r, a) => [C + r * Math.sin(a), C - r * Math.cos(a)]
  const [x0, y0] = p(R_OUT, a0 + gap)
  const [x1, y1] = p(R_OUT, a1 - gap)
  const [x2, y2] = p(R_IN, a1 - gap * 1.6)
  const [x3, y3] = p(R_IN, a0 + gap * 1.6)
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${x0},${y0} A${R_OUT},${R_OUT} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${R_IN},${R_IN} 0 ${large} 0 ${x3},${y3} Z`
}

function dotIcon(rows, cx, cy, step = 4.2) {
  const g = el('g', { class: 'icon' })
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === '#') g.appendChild(el('circle', { cx: cx + (x - 2) * step, cy: cy + (y - 2) * step, r: step * 0.38 }))
    })
  )
  return g
}

// Строка точечным шрифтом прямо в SVG (для заголовка в центре)
function dotText(text, cx, cy, pitch = 3.2) {
  const g = el('g', { class: 'dotline' })
  const rows = Dot.bitmap(text)
  const w = rows[0].length * pitch
  rows.forEach((row, y) =>
    row.forEach((on, x) => {
      g.appendChild(el('circle', { cx: cx - w / 2 + x * pitch + pitch / 2, cy: cy + (y - 3) * pitch, r: pitch * (on ? 0.36 : 0.2), class: on ? '' : 'off' }))
    })
  )
  return g
}

const current = () => actions[ring] ?? []

function render({ animate = 'show' } = {}) {
  svg.replaceChildren()
  const list = current()
  const n = list.length
  list.forEach((a, i) => {
    const a0 = (i / n) * Math.PI * 2 - Math.PI / n
    const a1 = a0 + (Math.PI * 2) / n
    const mid = (a0 + a1) / 2
    const rMid = (R_OUT + R_IN) / 2
    const cx = C + rMid * Math.sin(mid)
    const cy = C - rMid * Math.cos(mid)
    const icon = ICONS[a.id]
    const g = el('g', { class: 'slice' + (icon ? '' : ' format') + (i === hot ? ' hot' : '') })
    g.style.animationDelay = `${i * 25}ms`
    g.appendChild(el('path', { d: slicePath(a0, a1) }))
    if (icon) {
      g.appendChild(dotIcon(icon, cx, cy - 9))
      const t = el('text', { x: cx, y: cy + 20 })
      t.textContent = a.label
      g.appendChild(t)
    } else {
      const t = el('text', { x: cx, y: cy + 5 })
      t.textContent = a.label
      g.appendChild(t)
    }
    svg.appendChild(g)
  })

  // Центр: режим, файл, подсказка
  const hub = el('g', { class: 'hub' + (hot === -2 ? ' hot' : '') })
  hub.appendChild(el('circle', { class: 'disc', cx: C, cy: C, r: R_IN - 8 }))
  const title = !mode ? '' : !n && !actions.convert.length && !actions.tools.length ? (kindsKey ? 'НЕ УМЕЮ' : 'СЮДА') : ring === 'convert' ? 'ФОРМАТ' : 'ПРАВКА'
  hub.appendChild(dotText(title, C, C - 14, title.length > 8 ? 2.2 : 3.2))
  const file = el('text', { class: 'file', x: C, y: C + 14 })
  file.textContent = files ? (files.length > 1 ? `${files.length} файла` : shorten(baseName(files[0]), 22)) : kindsKey ? 'отпусти на секторе' : 'перетащи файл'
  hub.appendChild(file)
  const hint = el('text', { class: 'hint', x: C, y: C + 30 })
  const other = ring === 'convert' ? actions.tools.length : actions.convert.length
  hint.textContent = other ? (mode === 'click' ? 'Tab — ещё действия' : 'Shift — ещё действия') : mode === 'click' ? 'Esc — закрыть' : ''
  hint.dataset.base = hint.textContent
  hub.appendChild(hint)
  svg.appendChild(hub)

  if (animate) {
    svg.classList.remove('show', 'swap')
    void svg.getBoundingClientRect()
    svg.classList.add(animate)
  }
}

const baseName = (p) => p.split(/[\\/]/).pop()
const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// Какой сектор под точкой (координаты окна)
function hitTest(x, y) {
  const dx = x - (window.innerWidth / 2 - C) - C
  const dy = y - (window.innerHeight / 2 - C) - C
  const r = Math.hypot(dx, dy)
  if (r < R_IN) return -2
  if (r > R_OUT + 12) return -1
  const n = current().length
  if (!n) return -1
  let a = Math.atan2(dx, -dy) + Math.PI / n
  if (a < 0) a += Math.PI * 2
  return Math.floor((a / (Math.PI * 2)) * n) % n
}

// Подсветка — переключением классов: перерисовка заново проигрывала бы анимацию появления
function setHot(i) {
  if (i === hot) return
  hot = i
  svg.querySelectorAll('.slice').forEach((g, n) => g.classList.toggle('hot', n === i))
  svg.querySelector('.hub')?.classList.toggle('hot', i === -2)
  // Подсказка под курсором — в центре: «маленький, для всего», «замазать личное»…
  const hint = svg.querySelector('.hub .hint')
  if (!hint) return
  const tip = current()[i]?.hint
  hint.textContent = tip ?? hint.dataset.base
  hint.classList.toggle('tip', !!tip)
}

function toggleRing() {
  const other = ring === 'convert' ? 'tools' : 'convert'
  if (!actions[other].length) return
  ring = other
  hot = -1
  render({ animate: 'swap' })
}

function close() {
  mode = null
  window.familiar.dragshiftClose()
}

async function run(i, paths) {
  const a = current()[i]
  if (!a || !paths?.length) return
  mode = null
  await window.familiar.dragshiftRun(a.id, paths)
}

// ---------- Открытие ----------

window.familiar.onRadialOpen((opts) => {
  mode = opts.mode
  files = opts.files
  actions = opts.actions ?? { convert: [], tools: [] }
  ring = actions.convert.length ? 'convert' : 'tools'
  hot = -1
  kindsKey = files ? 'known' : ''
  render()
  // Когда закрыться в режиме drag, решает главный процесс: он видит кнопку мыши и Esc
})

window.familiar.onRadialToggle(toggleRing)

// ---------- Режим drag: файл тащат над меню ----------

document.addEventListener('dragenter', async (e) => {
  e.preventDefault()
  if (mode !== 'drag' || kindsKey) return
  window.familiar.dragshiftGot()
  // Имена файлов при перетаскивании скрыты, но MIME-тип уже виден — по нему подбираем действия
  const mimes = [...e.dataTransfer.items].filter((i) => i.kind === 'file').map((i) => i.type)
  kindsKey = mimes.join('|') || 'unknown'
  actions = await window.familiar.dragshiftActions(mimes)
  ring = actions.convert.length ? 'convert' : 'tools'
  render({ animate: 'swap' })
})

document.addEventListener('dragover', (e) => {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  setHot(hitTest(e.clientX, e.clientY))
})

// Увели файл с меню — гасим подсветку; бросят мимо — меню спрячется само (кнопку отпустили)
document.addEventListener('dragleave', (e) => e.relatedTarget === null && setHot(-1))

document.addEventListener('drop', async (e) => {
  e.preventDefault()
  const paths = [...e.dataTransfer.files].map((f) => window.familiar.pathForFile(f)).filter(Boolean)
  const i = hitTest(e.clientX, e.clientY)
  if (i >= 0 && current()[i]) return run(i, paths)
  // Бросили в центр или тип не угадали по MIME — показываем меню по именам файлов, дальше щелчком
  if (paths.length) window.familiar.convertFiles(paths)
  else close()
})

// ---------- Режим click: выбор мышью ----------

document.addEventListener('mousemove', (e) => mode === 'click' && setHot(hitTest(e.clientX, e.clientY)))
document.addEventListener('click', (e) => {
  if (mode !== 'click') return
  const i = hitTest(e.clientX, e.clientY)
  if (i >= 0) run(i, files)
  else if (i === -1) close()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') close()
  if (e.key === 'Tab' || e.key === 'Shift') {
    e.preventDefault()
    toggleRing()
  }
})
