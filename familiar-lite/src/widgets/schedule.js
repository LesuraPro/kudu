// Расписание пар на сегодня: текущая пара подсвечена и показывает, сколько осталось,
// следующая — через сколько начнётся. Учитывает числитель и знаменатель.
// Пары редактируются в «Настройки → Расписание». Перерисовка — раз в 30 секунд, без анимаций
Widget.define('schedule', (card) => {
  const head = Widget.el('div', 'head')
  const label = Widget.el('div', 'label', 'Расписание')
  const week = Widget.el('div', 'week')
  head.append(label, week)
  const list = Widget.el('div', 'pairs')
  const foot = Widget.el('div', 'foot')
  const edit = Widget.el('button', 'edit', 'Изменить ↗')
  edit.addEventListener('click', () => window.familiar.openSettings('schedule'))
  const status = Widget.el('div', 'status')
  foot.append(status, edit)
  card.append(head, list, foot)

  let data = null
  const DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
  const toMin = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number)
    return h * 60 + (m || 0)
  }

  // Числитель — нечётная неделя от даты начала семестра (её можно поправить в настройках)
  function parity(date) {
    // «2026-09-01» разбираем сами: new Date(строка) считает её по UTC и может уехать на день
    const [y, m, d] = String(data?.weekStart ?? '').split('-').map(Number)
    const start = y ? new Date(y, m - 1, d) : new Date(date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1, 8, 1)
    const monday = (d) => {
      const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
      return x
    }
    const weeks = Math.round((monday(date) - monday(start)) / (7 * 86400000))
    return ((weeks % 2) + 2) % 2 === 0 ? 'odd' : 'even'
  }

  const pairsFor = (date) => {
    const p = parity(date)
    return (data?.days?.[date.getDay()] ?? [])
      .filter((x) => !x.week || x.week === 'all' || x.week === p)
      .sort((a, b) => toMin(a.start) - toMin(b.start))
  }

  function row(pair, i, state, note) {
    const el = Widget.el('div', `pair ${state}`)
    const time = Widget.el('div', 'time')
    time.append(Widget.el('b', '', pair.start), Widget.el('span', '', pair.end))
    const body = Widget.el('div', 'body')
    body.append(Widget.el('div', 'name', `${i + 1}. ${pair.name || 'Пара'}`))
    const meta = [pair.type, pair.room && `ауд. ${pair.room}`, note].filter(Boolean).join(' · ')
    if (meta) body.append(Widget.el('div', 'meta', meta))
    el.append(time, body)
    if (state === 'now') {
      // Полоска: сколько пары уже прошло
      const bar = Widget.el('i', 'bar')
      const total = toMin(pair.end) - toMin(pair.start)
      const now = new Date()
      bar.style.setProperty('--done', `${Math.min(100, Math.max(0, ((now.getHours() * 60 + now.getMinutes() - toMin(pair.start)) / total) * 100))}%`)
      el.append(bar)
    }
    return el
  }

  function render() {
    const now = new Date()
    const mins = now.getHours() * 60 + now.getMinutes()
    let day = now
    let pairs = pairsFor(now)
    let tomorrow = false
    // Сегодня пар нет или все кончились — показываем ближайший учебный день
    if (!pairs.length || mins >= toMin(pairs.at(-1).end)) {
      for (let k = 1; k <= 7; k++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k)
        const p = pairsFor(d)
        if (p.length) {
          day = d
          pairs = p
          tomorrow = true
          break
        }
      }
    }
    const ahead = Math.round((new Date(day.getFullYear(), day.getMonth(), day.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000)
    week.textContent = `${ahead === 1 ? 'завтра' : DAYS[day.getDay()]} · ${parity(day) === 'odd' ? 'числитель' : 'знаменатель'}`
    if (!pairs.length) {
      list.replaceChildren(Widget.el('div', 'empty', 'Пар пока нет. Добавь их в «Изменить ↗» — можно вставить пример'))
      status.textContent = ''
      return
    }
    let note = ''
    list.replaceChildren(
      ...pairs.map((p, i) => {
        if (tomorrow) return row(p, i, '')
        const s = toMin(p.start)
        const e = toMin(p.end)
        if (mins >= e) return row(p, i, 'past')
        if (mins >= s) {
          note = `до конца пары ${e - mins} мин`
          return row(p, i, 'now', `ещё ${e - mins} мин`)
        }
        const prevEnd = i ? toMin(pairs[i - 1].end) : -1
        if (mins < s && (i === 0 ? true : mins >= prevEnd)) {
          note ||= s - mins <= 120 ? `следующая через ${s - mins} мин` : `первая в ${p.start}`
          return row(p, i, 'next', s - mins <= 120 ? `через ${s - mins} мин` : '')
        }
        return row(p, i, '')
      })
    )
    status.textContent = tomorrow ? `${pairs.length} пар · начало в ${pairs[0].start}` : note
    list.querySelector('.now, .next')?.scrollIntoView({ block: 'nearest' })
  }

  async function load() {
    data = await window.familiar.widgetData('schedule')
    render()
  }
  load()
  window.familiar.onWidgetData((name, value) => name === 'schedule' && ((data = value), render()))
  // Минуты до конца пары меняются раз в минуту — полминуты точности хватает с запасом
  setInterval(() => !document.hidden && render(), 30000)
  document.addEventListener('visibilitychange', () => !document.hidden && render())
})
