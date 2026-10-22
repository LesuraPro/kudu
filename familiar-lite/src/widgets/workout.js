// Тренировки: счётчики повторений за сегодня (по умолчанию — подтягивания и брусья),
// цель на день точками, серия дней подряд, неделя столбиками и вес.
// Всё хранится в config.json; виджет перерисовывается только по нажатию — без анимаций
Widget.define('workout', (card) => {
  const head = Widget.el('div', 'head')
  const label = Widget.el('div', 'label', 'Тренировки')
  const streakEl = Widget.el('div', 'streak')
  head.append(label, streakEl)
  const rows = Widget.el('div', 'rows')
  const chart = Widget.el('canvas', 'week')
  const weightRow = Widget.el('div', 'weight')
  const weightIn = Widget.el('input')
  weightIn.type = 'number'
  weightIn.step = '0.1'
  weightIn.placeholder = 'вес'
  const weightNote = Widget.el('span', 'note')
  weightRow.append(Widget.el('span', '', 'Вес'), weightIn, Widget.el('span', 'unit', 'кг'), weightNote)
  card.append(head, rows, chart, weightRow)

  const DEFAULT = { exercises: ['Подтягивания', 'Брусья'], goals: { Подтягивания: 50, Брусья: 60 }, log: {}, weight: {} }
  let data = structuredClone(DEFAULT)
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const today = () => iso(new Date())
  const dayTotal = (key) => Object.values(data.log[key] ?? {}).reduce((a, b) => a + b, 0)

  let saveTimer
  function save() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => window.familiar.setWidgetData('workout', data), 400)
  }

  function add(ex, n) {
    const day = (data.log[today()] ??= {})
    day[ex] = Math.max(0, (day[ex] ?? 0) + n)
    save()
    render()
  }

  // Серия: сколько дней подряд (по сегодня или вчера включительно) была хоть одна тренировка
  function streak() {
    let n = 0
    const d = new Date()
    if (!dayTotal(iso(d))) d.setDate(d.getDate() - 1)
    while (dayTotal(iso(d)) > 0 && n < 3650) {
      n++
      d.setDate(d.getDate() - 1)
    }
    return n
  }

  function exerciseRow(ex) {
    const count = data.log[today()]?.[ex] ?? 0
    const goal = data.goals[ex] ?? 50
    const row = Widget.el('div', 'ex' + (count >= goal ? ' done' : ''))
    const top = Widget.el('div', 'top')
    top.append(Widget.el('span', 'name', ex), Widget.el('b', 'count', String(count)), Widget.el('span', 'goal', `/ ${goal}`))
    // Цель — 10 точек: каждая — десятая часть
    const dots = Widget.el('div', 'dots')
    const lit = Math.min(10, Math.floor((count / goal) * 10))
    for (let i = 0; i < 10; i++) dots.append(Widget.el('i', i < lit ? 'on' : ''))
    const btns = Widget.el('div', 'btns')
    for (const n of [1, 5, 10]) {
      const b = Widget.el('button', '', `+${n}`)
      b.addEventListener('click', () => add(ex, n))
      btns.append(b)
    }
    const minus = Widget.el('button', 'minus', '−1')
    minus.title = 'Ошибся — убрать одно'
    minus.addEventListener('click', () => add(ex, -1))
    btns.append(minus)
    row.append(top, dots, btns)
    return row
  }

  // Неделя столбиками из точек: высота — сколько всего повторений, сегодня — акцентом
  function drawWeek() {
    const { ctx, w, h } = Dot.fit(chart)
    ctx.clearRect(0, 0, w, h)
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      days.push({ d, total: dayTotal(iso(d)) })
    }
    const max = Math.max(1, ...days.map((x) => x.total))
    const rowsN = 6
    const step = h / (rowsN + 2)
    const b = Dot.batch(ctx)
    days.forEach((x, i) => {
      const cx = ((i + 0.5) * w) / 7
      const lit = x.total ? Math.max(1, Math.round((x.total / max) * rowsN)) : 0
      for (let r = 0; r < rowsN; r++) b.dot(cx, h - step * 1.6 - r * step, 2.2, r < lit ? (i === 6 ? Dot.css('--accent') : Dot.css('--text')) : Dot.css('--dot-off'))
    })
    b.flush()
    ctx.fillStyle = Dot.css('--muted')
    ctx.font = `9px ${getComputedStyle(document.body).fontFamily}`
    ctx.textAlign = 'center'
    days.forEach((x, i) => ctx.fillText(x.d.toLocaleDateString('ru-RU', { weekday: 'short' }).toUpperCase(), ((i + 0.5) * w) / 7, h - 2))
  }

  function render() {
    rows.replaceChildren(...data.exercises.map(exerciseRow))
    const s = streak()
    streakEl.textContent = s ? `серия ${s} дн.` : 'начни серию'
    drawWeek()
    // Вес: сегодняшний (если вводили) и изменение за неделю
    const keys = Object.keys(data.weight).sort()
    const last = keys.at(-1)
    if (document.activeElement !== weightIn) weightIn.value = last ? data.weight[last] : ''
    const weekAgo = keys.filter((k) => k <= iso(new Date(Date.now() - 7 * 86400000))).at(-1)
    if (last && weekAgo) {
      const diff = data.weight[last] - data.weight[weekAgo]
      weightNote.textContent = `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff).toFixed(1)} за неделю`
    } else weightNote.textContent = last ? (last === today() ? 'записан сегодня' : `с ${last.slice(8)}.${last.slice(5, 7)}`) : 'запиши утром'
  }

  weightIn.addEventListener('change', () => {
    const v = parseFloat(weightIn.value.replace(',', '.'))
    if (!(v > 20 && v < 400)) return
    data.weight[today()] = Math.round(v * 10) / 10
    save()
    render()
  })

  async function load() {
    const saved = await window.familiar.widgetData('workout')
    data = { ...structuredClone(DEFAULT), ...(saved ?? {}) }
    render()
  }
  load()
  window.familiar.onWidgetData((name, value) => name === 'workout' && value && ((data = { ...structuredClone(DEFAULT), ...value }), render()))
  // Наступил новый день — счётчики обнуляются сами (это просто новая дата в журнале)
  setInterval(() => !document.hidden && render(), 10 * 60 * 1000)
  window.addEventListener('familiar-palette', drawWeek)
  new ResizeObserver(drawWeek).observe(chart)
})
