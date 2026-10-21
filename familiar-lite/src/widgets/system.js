// Нагрузка: линия ЦП или памяти за последние 2 минуты + текущий процент точками.
// Клик по названию переключает CPU / RAM.
Widget.define('system', (card) => {
  const MODES = { cpu: 'CPU', mem: 'RAM' }
  let mode = localStorage.sysMode in MODES ? localStorage.sysMode : 'cpu'

  const head = Widget.el('div', 'head')
  const chips = Widget.el('div', 'chips')
  for (const [key, label] of Object.entries(MODES)) {
    const b = Widget.el('button', key === mode ? 'active' : '', label)
    b.addEventListener('click', () => {
      mode = key
      try {
        localStorage.sysMode = key
      } catch {}
      chips.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b))
    })
    chips.appendChild(b)
  }
  const value = Widget.el('canvas', 'value')
  head.append(chips, value)
  const graph = Widget.el('canvas', 'graph')
  const foot = Widget.el('div', 'foot')
  card.append(head, graph, foot)

  const HISTORY = 120
  const history = { cpu: [], mem: [] }
  let memTotal = 0

  function onStats(s) {
    for (const k of Object.keys(history)) {
      history[k].push(s[k] ?? 0)
      if (history[k].length > HISTORY) history[k].shift()
    }
    memTotal = s.memTotal ?? memTotal
  }
  window.familiar.getStats().then(onStats)
  window.familiar.onStats(onStats)

  // Плавно «доезжающее» значение для цифр и конца линии
  let shown = 0

  Widget.loop((t, dt) => {
    const data = history[mode]
    const current = data.at(-1) ?? 0
    shown += (current - shown) * Math.min(1, dt * 6)
    const on = Dot.css('--text')
    const off = Dot.css('--dot-off')
    const accent = Dot.css('--accent')
    const hot = shown > 0.85

    // Процент точечным шрифтом
    const v = Dot.fit(value)
    v.ctx.clearRect(0, 0, v.w, v.h)
    const text = `${Math.round(shown * 100)}%`
    const pitch = v.h / 7
    Dot.draw(v.ctx, text, v.w - Dot.width(text) * pitch, 0, { pitch, on: hot ? accent : on, off })

    // График: сетка из погасших точек, поверх — линия и заливка
    const g = Dot.fit(graph)
    const { ctx, w, h } = g
    ctx.clearRect(0, 0, w, h)
    const step = 12
    ctx.fillStyle = off
    for (let x = step / 2; x < w; x += step) for (let y = step / 2; y < h; y += step) {
      ctx.beginPath()
      ctx.arc(x, y, 1.2, 0, Math.PI * 2)
      ctx.fill()
    }
    if (data.length > 1) {
      const pts = data.map((d, i) => [w - (data.length - 1 - i) * (w / (HISTORY - 1)), h - 4 - d * (h - 8)])
      pts[pts.length - 1][1] = h - 4 - shown * (h - 8)

      const fill = ctx.createLinearGradient(0, 0, 0, h)
      fill.addColorStop(0, hot ? 'rgba(255,45,45,0.35)' : 'rgba(255,255,255,0.18)')
      fill.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.beginPath()
      ctx.moveTo(pts[0][0], h)
      for (const [x, y] of pts) ctx.lineTo(x, y)
      ctx.lineTo(w, h)
      ctx.fillStyle = fill
      ctx.fill()

      ctx.beginPath()
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.strokeStyle = on
      ctx.lineWidth = 1.5
      ctx.stroke()

      // Красная «живая» точка на конце линии
      const [lx, ly] = pts[pts.length - 1]
      ctx.fillStyle = accent
      ctx.beginPath()
      ctx.arc(lx - 3, ly, 3 + Math.sin(t * 6) * 0.8, 0, Math.PI * 2)
      ctx.fill()
    }

    const gb = (b) => (b / 1024 ** 3).toFixed(1)
    Widget.text(
      foot,
      mode === 'mem' && memTotal
        ? `${gb(shown * memTotal)} / ${gb(memTotal)} GB · 2 мин`
        : `пик ${Math.round(Math.max(0, ...data) * 100)}% · 2 мин`
    )
  }, { fps: 10 })
})
