// Круглые точечные часы: 60 точек по кругу — секунды, в центре часы над минутами
Widget.define('clock', (card) => {
  const canvas = Widget.el('canvas')
  const date = Widget.el('div', 'date')
  card.append(canvas, date)

  Widget.loop((t) => {
    const { ctx, w, h } = Dot.fit(canvas)
    const now = new Date()
    const sec = now.getSeconds() + now.getMilliseconds() / 1000
    const on = Dot.css('--text')
    const off = Dot.css('--dot-off')
    const accent = Dot.css('--accent')
    ctx.clearRect(0, 0, w, h)

    // Кольцо секунд: пройденные горят, текущая — красная и «дышит»
    const cx = w / 2
    const cy = h / 2
    const R = w / 2 - 6
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2 - Math.PI / 2
      const current = i === Math.floor(sec)
      ctx.fillStyle = current ? accent : i < sec ? on : off
      const r = current ? 3 + Math.sin(t * 8) * 0.6 : i % 5 === 0 ? 2.4 : 1.7
      ctx.beginPath()
      ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, r, 0, Math.PI * 2)
      ctx.fill()
    }

    // Часы и минуты точечным шрифтом друг под другом
    const pitch = 7
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const tw = Dot.width(hh) * pitch
    Dot.draw(ctx, hh, cx - tw / 2, cy - 7 * pitch - 4, { pitch, on, off })
    Dot.draw(ctx, mm, cx - tw / 2, cy + 4, { pitch, on, off })

    date.textContent = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
  })
})
