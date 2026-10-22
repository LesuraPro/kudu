// Обратный отсчёт: сколько дней до события (сессия, экзамен, отпуск) — большими точками.
// Щелчок по подписи — поменять событие и дату. Перерисовка — раз в 10 минут (дни меняются редко)
Widget.define('countdown', (card) => {
  const label = Widget.el('div', 'label', 'Обратный отсчёт')
  const canvas = Widget.el('canvas')
  const caption = Widget.el('button', 'caption')
  caption.title = 'Изменить событие'
  const form = Widget.el('div', 'form')
  const titleIn = Widget.el('input')
  titleIn.placeholder = 'Что ждём? Например, «Сессия»'
  const dateIn = Widget.el('input')
  dateIn.type = 'date'
  const ok = Widget.el('button', 'ok', 'Готово')
  form.append(titleIn, dateIn, ok)
  form.hidden = true
  card.append(label, canvas, caption, form)

  // По умолчанию — до зимней сессии (последняя неделя декабря)
  const now0 = new Date()
  let data = { title: 'Сессия', date: `${now0.getMonth() === 11 && now0.getDate() > 25 ? now0.getFullYear() + 1 : now0.getFullYear()}-12-25` }
  let shown = ''

  const daysLeft = () => {
    const [y, m, d] = data.date.split('-').map(Number)
    const target = new Date(y, m - 1, d)
    const today = new Date()
    return Math.round((target - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000)
  }

  // 1 день, 3 дня, 5 дней
  const word = (n) => {
    const a = Math.abs(n) % 100
    const b = a % 10
    return a > 10 && a < 20 ? 'дней' : b === 1 ? 'день' : b >= 2 && b <= 4 ? 'дня' : 'дней'
  }

  function render() {
    const n = daysLeft()
    const { ctx, w, h } = Dot.fit(canvas)
    const key = `${n}:${w}x${h}:${Dot.css('--text')}${Dot.css('--accent')}`
    if (key !== shown) {
      shown = key
      ctx.clearRect(0, 0, w, h)
      const text = n === 0 ? 'СЕГОДНЯ' : String(Math.abs(n))
      // Шаг точки — чтобы число заняло ширину, но не больше 9 px
      const pitch = Math.max(3, Math.min(9, Math.floor((w - 8) / Dot.width(text)), Math.floor(h / 7)))
      const tw = Dot.width(text) * pitch
      Dot.draw(ctx, text, (w - tw) / 2, (h - 7 * pitch) / 2, { pitch, on: n <= 7 && n >= 0 ? Dot.css('--accent') : Dot.css('--text'), off: Dot.css('--dot-off') })
    }
    const [y, m, d] = data.date.split('-').map(Number)
    const when = new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    caption.textContent = n > 0 ? `${word(n)} до «${data.title}» · ${when}` : n === 0 ? `«${data.title}» — сегодня!` : `${word(n)} после «${data.title}»`
  }

  caption.addEventListener('click', () => {
    titleIn.value = data.title
    dateIn.value = data.date
    form.hidden = false
    caption.hidden = true
    titleIn.focus()
  })
  const done = () => {
    if (dateIn.value) data = { title: titleIn.value.trim() || 'Событие', date: dateIn.value }
    form.hidden = true
    caption.hidden = false
    shown = ''
    render()
    window.familiar.setWidgetData('countdown', data)
  }
  ok.addEventListener('click', done)
  form.addEventListener('keydown', (e) => e.key === 'Enter' && done())

  window.familiar.widgetData('countdown').then((d) => {
    if (d?.date) data = d
    render()
  })
  setInterval(() => !document.hidden && render(), 10 * 60 * 1000)
  window.addEventListener('familiar-palette', () => ((shown = ''), render()))
  new ResizeObserver(() => ((shown = ''), render())).observe(canvas)
})
