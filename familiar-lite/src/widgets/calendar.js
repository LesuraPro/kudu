// Календарь: месяц точками, сегодня — красным, у дней с напоминаниями — точка.
// Клик по дню — напоминания на эту дату и поле, чтобы добавить новое.
Widget.define('calendar', (card) => {
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
  const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

  // «2026-10-21» в местном времени (toISOString дал бы дату по Гринвичу)
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const head = Widget.el('div', 'head')
  const prev = Widget.el('button', 'nav', '‹')
  const title = Widget.el('canvas', 'title')
  const next = Widget.el('button', 'nav', '›')
  head.append(prev, title, next)
  const week = Widget.el('div', 'week')
  week.append(...WEEK.map((d) => Widget.el('span', '', d)))
  const days = Widget.el('div', 'days')
  const dayLabel = Widget.el('div', 'label')
  const list = Widget.el('ul')
  const input = Widget.el('input')
  card.append(head, week, days, dayLabel, list, input)

  const today = new Date()
  let month = new Date(today.getFullYear(), today.getMonth(), 1)
  let selected = key(today)
  let reminders = []

  prev.addEventListener('click', () => ((month = new Date(month.getFullYear(), month.getMonth() - 1, 1)), render()))
  next.addEventListener('click', () => ((month = new Date(month.getFullYear(), month.getMonth() + 1, 1)), render()))

  function render() {
    const todayKey = key(new Date())
    const withReminders = new Set(reminders.filter((r) => r.date && !r.done).map((r) => r.date))
    // Неделя с понедельника: сдвигаем начало сетки назад до понедельника
    const first = new Date(month)
    first.setDate(1 - ((first.getDay() + 6) % 7))
    const cells = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)
      const k = key(d)
      const b = Widget.el('button', 'day', String(d.getDate()))
      if (d.getMonth() !== month.getMonth()) b.classList.add('other')
      if (k === todayKey) b.classList.add('today')
      if (k === selected) b.classList.add('selected')
      if (withReminders.has(k)) b.classList.add('has')
      if ((d.getDay() + 6) % 7 >= 5) b.classList.add('weekend')
      b.addEventListener('click', () => {
        selected = k
        if (d.getMonth() !== month.getMonth()) month = new Date(d.getFullYear(), d.getMonth(), 1)
        render()
      })
      cells.push(b)
    }
    days.replaceChildren(...cells)
    drawTitle()
    renderDay()
  }

  function renderDay() {
    const [y, m, d] = selected.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    const pretty = date.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })
    dayLabel.textContent = pretty
    input.placeholder = `Напомнить на ${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} + Enter`
    const items = reminders.filter((r) => r.date === selected)
    list.replaceChildren(
      ...(items.length
        ? items.map((r) => {
            const li = Widget.el('li', r.done ? 'done' : '')
            li.append(Widget.el('i', 'box'), Widget.el('span', '', r.text))
            li.addEventListener('click', () => {
              r.done = !r.done
              save()
            })
            return li
          })
        : [Widget.el('li', 'empty', 'Ничего не запланировано')])
    )
  }

  // Название месяца точечным шрифтом
  function drawTitle() {
    const { ctx, w, h } = Dot.fit(title)
    ctx.clearRect(0, 0, w, h)
    const text = `${MONTHS[month.getMonth()]} ${month.getFullYear()}`.toUpperCase()
    const pitch = Math.min(h / 7, w / Dot.width(text))
    Dot.draw(ctx, text, (w - Dot.width(text) * pitch) / 2, (h - 7 * pitch) / 2, {
      pitch,
      on: Dot.css('--text'),
      off: null
    })
  }

  function save() {
    render()
    window.familiar.setReminders(reminders)
  }

  input.addEventListener('keydown', (e) => {
    const text = input.value.trim()
    if (e.key !== 'Enter' || !text) return
    reminders.push({ text, done: false, date: selected })
    input.value = ''
    save()
  })

  function load(config) {
    reminders = config.reminders ?? []
    render()
  }
  window.familiar.getConfig().then(load)
  window.familiar.onConfigChanged(load)

  // В полночь перерисовываем, чтобы «сегодня» переехало
  setInterval(() => {
    if (key(new Date()) !== key(today)) location.reload()
  }, 60 * 1000)
})
