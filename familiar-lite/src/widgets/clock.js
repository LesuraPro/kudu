// Круглые точечные часы: 60 точек по кругу — секунды, в центре часы над минутами
Widget.define('clock', (card) => {
  const canvas = Widget.el('canvas')
  const date = Widget.el('div', 'date')
  card.append(canvas, date)

  // Картинка меняется дважды в секунду (секунда и мигание текущей точки) — рисуем, только
  // когда она правда другая; 4 кадров хватает, чтобы не пропустить смену
  let shown = ''

  Widget.loop((t) => {
    const { ctx, w, h } = Dot.fit(canvas)
    const now = new Date()
    const sec = now.getSeconds()
    const blink = now.getMilliseconds() < 500
    const on = Dot.css('--text')
    const off = Dot.css('--dot-off')
    const accent = Dot.css('--accent')
    const key = `${now.getHours()}:${now.getMinutes()}:${sec}:${blink}:${w}x${h}:${on}${accent}`
    if (key === shown) return
    shown = key
    ctx.clearRect(0, 0, w, h)

    // Кольцо секунд: пройденные горят, текущая — красная и мигает
    const cx = w / 2
    const cy = h / 2
    const R = w / 2 - 6
    const dots = Dot.batch(ctx)
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 - Math.PI / 2
      const current = i === sec
      const r = current ? (blink ? 3.3 : 2.6) : i % 5 === 0 ? 2.4 : 1.7
      dots.dot(cx + Math.cos(a) * R, cy + Math.sin(a) * R, r, current ? accent : i < sec ? on : off)
    }
    dots.flush()

    // Часы и минуты точечным шрифтом друг под другом
    const pitch = 7
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const tw = Dot.width(hh) * pitch
    Dot.draw(ctx, hh, cx - tw / 2, cy - 7 * pitch - 4, { pitch, on, off })
    Dot.draw(ctx, mm, cx - tw / 2, cy + 4, { pitch, on, off })

    Widget.text(date, now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }))
  }, { fps: 4 })
})
