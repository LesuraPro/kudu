// Визуализатор: круг из точек, реагирует на звук. Режимы как в Familiar:
// SPACE, PULSE, RIPPLE, TORUS, CLOCK, TICKER. Выбор режима запоминается.
// Если сделать окно маленьким — останется только «глаз» без кнопок.
Widget.define('visualizer', (card) => {
  const MODES = ['space', 'pulse', 'ripple', 'torus', 'clock', 'ticker']
  let mode = MODES.includes(localStorage.vizMode) ? localStorage.vizMode : 'ripple'

  const chips = Widget.el('div', 'chips')
  for (const m of MODES) {
    const b = Widget.el('button', m === mode ? 'active' : '', m.toUpperCase())
    b.addEventListener('click', () => {
      mode = m
      try {
        localStorage.vizMode = m
      } catch {}
      chips.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b))
    })
    chips.appendChild(b)
  }
  const canvas = Widget.el('canvas')
  const foot = Widget.el('div', 'foot')
  const pill = Widget.el('div', 'pill live')
  const marquee = Widget.el('div', 'marquee')
  const marqueeText = Widget.el('span')
  marquee.appendChild(marqueeText)
  pill.append(Widget.el('i', 'dot'), marquee)
  const src = Widget.el('div', 'src')
  foot.append(pill, src)
  card.append(chips, canvas, foot)
  const scrollText = Dot.marquee(marquee, marqueeText)

  // Погасшие точки круга не меняются — рисуем их один раз в отдельный холст и потом
  // только копируем картинкой (сотни кружочков за кадр → одна операция)
  let backdrop = null
  function offDots(w, h, n, pitch, ox, oy, color) {
    const key = `${w}x${h}:${n}:${color}`
    if (backdrop?.key === key) return backdrop.canvas
    const dpr = window.devicePixelRatio || 1
    const c = document.createElement('canvas')
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    const bctx = c.getContext('2d')
    bctx.scale(dpr, dpr)
    const center = (n - 1) / 2
    const b = Dot.batch(bctx)
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (Math.hypot(x - center, y - center) > center + 0.3) continue
      b.dot(ox + x * pitch + pitch / 2, oy + y * pitch + pitch / 2, pitch * 0.2, color)
    }
    b.flush()
    backdrop = { key, canvas: c }
    return c
  }

  Media.onChange((m) => {
    marqueeText.textContent = Media.hasTrack() ? `Now playing · ${m.title} — ${m.artist}` : 'Familiar Lite · тишина'
    pill.classList.toggle('live', Media.playing())
  })

  Sound.start()

  // Сетка яркостей b[y][x] от 0 до 1
  let N = 25
  let grid = new Float32Array(N * N)
  const setDot = (x, y, v) => {
    if (x >= 0 && y >= 0 && x < N && y < N) grid[y * N + x] = Math.max(grid[y * N + x], v)
  }

  // Звёзды для SPACE: x, y в [-1, 1], z — расстояние (чем меньше, тем ближе)
  const stars = Array.from({ length: 140 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() }))

  const renderers = {
    // Полёт сквозь звёзды: громкость = скорость
    space(t, lvl, spec, dt) {
      grid.fill(0)
      const c = (N - 1) / 2
      for (const s of stars) {
        s.z -= dt * (0.15 + lvl * 1.6)
        if (s.z <= 0.02) Object.assign(s, { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: 1 })
        const px = Math.round(c + (s.x / s.z) * c * 0.35)
        const py = Math.round(c + (s.y / s.z) * c * 0.35)
        setDot(px, py, Math.min(1, (1 - s.z) * 1.3))
      }
      setDot(Math.round(c), Math.round(c), 0.4)
    },
    // Радиальный «цветок»: радиус по каждому направлению = громкость своей полосы
    pulse(t, lvl, spec) {
      const c = (N - 1) / 2
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = x - c
        const dy = y - c
        const r = Math.hypot(dx, dy) / c
        const ang = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)
        const band = spec[Math.floor(Math.abs(ang * 2 - 1) * (spec.length - 1) * 0.6)]
        const edge = 0.18 + band * 0.75 + lvl * 0.1
        grid[y * N + x] = r < edge ? 0.25 + 0.75 * (r / edge) : 0
      }
    },
    // Круги, расходящиеся от центра; громкость — сила волны
    ripple(t, lvl) {
      const c = (N - 1) / 2
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const r = Math.hypot(x - c, y - c) / c
        const wave = 0.5 + 0.5 * Math.sin(r * 13 - t * 5)
        grid[y * N + x] = Math.pow(wave, 3) * (0.25 + lvl * 1.4) * (1.15 - r)
      }
    },
    // Вращающийся бублик (тор), «дышит» под бас
    torus(t, lvl) {
      grid.fill(0)
      const R = 0.62 + lvl * 0.1
      const r = 0.16 + lvl * 0.05
      // Наклон качается, но не доходит до «ребра», чтобы дырка всегда была видна,
      // а сам бублик крутится в плоскости экрана
      const ax = 0.6 + Math.sin(t * 0.5) * 0.2
      const az = t * 0.6
      for (let i = 0; i < 48; i++) {
        const u = (i / 48) * Math.PI * 2
        for (let j = 0; j < 18; j++) {
          const v = (j / 18) * Math.PI * 2
          let x = (R + r * Math.cos(v)) * Math.cos(u)
          let y = (R + r * Math.cos(v)) * Math.sin(u)
          let z = r * Math.sin(v)
          ;[y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)]
          ;[x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)]
          const px = Math.round(((x + 1) / 2) * (N - 1))
          const py = Math.round(((y + 1) / 2) * (N - 1))
          setDot(px, py, 0.35 + (z + 0.8) * 0.45)
        }
      }
    },
    // Часы над минутами точечным шрифтом + бегущие по кругу секунды
    clock(t, lvl) {
      grid.fill(0)
      const now = new Date()
      const parts = [now.getHours(), now.getMinutes()].map((n) => String(n).padStart(2, '0'))
      parts.forEach((text, i) => {
        const bm = Dot.bitmap(text)
        const ox = Math.floor((N - bm[0].length) / 2)
        const oy = Math.floor(N / 2) - 8 + i * 9
        bm.forEach((row, y) => row.forEach((on, x) => on && setDot(ox + x, oy + y, 1)))
      })
      const c = (N - 1) / 2
      const sec = now.getSeconds() + now.getMilliseconds() / 1000
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2 - Math.PI / 2
        const x = Math.round(c + Math.cos(a) * c)
        const y = Math.round(c + Math.sin(a) * c)
        setDot(x, y, i < sec ? 0.55 + lvl * 0.4 : 0.12)
      }
    },
    // Бегущая строка с названием трека + спектр сверху и снизу
    ticker(t, lvl, spec) {
      grid.fill(0)
      const m = Media.get()
      const text = (Media.hasTrack() ? `${m.title} — ${m.artist}   ` : 'FAMILIAR LITE   ').toUpperCase()
      const bm = Dot.bitmap(text)
      const len = bm[0].length
      const shift = Math.floor(t * 12) % len
      const oy = Math.floor((N - 7) / 2)
      for (let y = 0; y < 7; y++) for (let x = 0; x < N; x++) if (bm[y][(x + shift) % len]) setDot(x, oy + y, 1)
      for (let x = 0; x < N; x++) {
        const h = Math.round(spec[Math.floor((x / N) * spec.length * 0.7)] * (oy - 1))
        for (let k = 0; k < h; k++) {
          setDot(x, oy - 2 - k, 0.3 + (k / oy) * 0.6)
          setDot(x, oy + 8 + k, 0.3 + (k / oy) * 0.6)
        }
      }
    }
  }

  Widget.loop((t, dt) => {
    const { ctx, w, h } = Dot.fit(canvas)
    // Размер сетки подстраиваем под размер окна: шаг точки ~11px
    const size = Math.min(w, h)
    const n = Math.max(15, Math.min(41, Math.floor(size / 11) | 1))
    if (n !== N) {
      N = n
      grid = new Float32Array(N * N)
    }

    // Маленькое окно — только «глаз»
    card.classList.toggle('compact', Math.min(window.innerWidth, window.innerHeight) < 230)

    Sound.update(t)
    const lvl = Sound.level()
    renderers[mode](t, lvl, Sound.spectrum, dt)

    Widget.text(src, Sound.source() === 'loopback' ? 'LIVE AUDIO' : 'SIM')

    scrollText(dt)
    ctx.clearRect(0, 0, w, h)
    const pitch = size / N
    const ox = (w - size) / 2
    const oy = (h - size) / 2
    const c = (N - 1) / 2
    const on = Dot.css('--text')
    const accent = Dot.css('--accent')
    ctx.drawImage(offDots(w, h, N, pitch, ox, oy, Dot.css('--dot-off')), 0, 0, w, h)
    const dots = Dot.batch(ctx)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const b = Math.min(1, grid[y * N + x])
      if (b < 0.06) continue
      // Только точки внутри круга — как «глаз» в Familiar
      if (Math.hypot(x - c, y - c) > c + 0.3) continue
      // Яркость — 6 ступенек: точки одной ступени рисуются одной заливкой
      const q = Math.round(b * 6) / 6
      // Самые яркие точки на пиках громкости вспыхивают красным
      dots.dot(ox + x * pitch + pitch / 2, oy + y * pitch + pitch / 2, pitch * (0.2 + q * 0.18), b > 0.92 && lvl > 0.45 ? accent : on, 0.25 + q * 0.75)
    }
    dots.flush()
    // Музыка или живой звук — 24 кадра (глазу хватает); часы меняются раз в секунду; тишина — спокойные 6
    // Живой звук системы слушаем всегда, но полную частоту включаем, только когда он правда звучит
  }, { fps: () => (mode === 'clock' ? 4 : Media.playing() || (Sound.source() === 'loopback' && Sound.level() > 0.02) ? 24 : 6) })
})
