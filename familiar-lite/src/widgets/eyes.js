// Глазки из точек: следят за курсором, моргают, радуются музыке,
// засыпают, если долго не трогать мышь, и удивляются, если навести на них курсор.
// Кликов не ловим — так виджет можно таскать за любое место.
Widget.define('eyes', (card) => {
  const canvas = Widget.el('canvas')
  card.append(canvas)

  const N = 21 // сетка N×N точек
  let grid = new Uint8Array(N * N) // 0 — погасшая, 1 — белая, 2 — красная
  let prevGrid = null // что нарисовано сейчас — чтобы не перерисовывать то же самое
  let prevKey = ''
  const set = (x, y, v = 1) => {
    if (x >= 0 && y >= 0 && x < N && y < N) grid[y * N + x] = v
  }

  // Куда смотрят зрачки: -1…1 по каждой оси, сглаженно
  const look = { x: 0, y: 0 }
  const target = { x: 0, y: 0 }
  let lastCursor = null
  let idleSince = performance.now()
  let surprisedUntil = 0
  let nextBlink = performance.now() + 2000
  let blinkUntil = 0

  // Позицию курсора спрашиваем у главного процесса — окно ведь его не видит
  // Как часто спрашивать: курсор двигается — 20 раз в секунду (глаза следят плавно),
  // замер — 4 раза, спим — раз в секунду. Окно скрыто или пауза — глазам смотреть некуда
  function trackDelay() {
    if (document.hidden || Power.mode() === 'paused') return 1000
    const idle = performance.now() - idleSince
    return idle < 2000 ? 50 : idle < 30000 ? 250 : 1000
  }
  async function trackLoop() {
    await trackCursor()
    setTimeout(trackLoop, trackDelay())
  }
  async function trackCursor() {
    if (document.hidden || Power.mode() === 'paused') return
    const p = await window.familiar.cursor()
    const cx = window.screenX + window.innerWidth / 2
    const cy = window.screenY + window.innerHeight / 2
    target.x = Math.max(-1, Math.min(1, (p.x - cx) / 500))
    target.y = Math.max(-1, Math.min(1, (p.y - cy) / 350))
    if (!lastCursor || lastCursor.x !== p.x || lastCursor.y !== p.y) idleSince = performance.now()
    const inside = p.x >= window.screenX && p.x < window.screenX + window.innerWidth && p.y >= window.screenY && p.y < window.screenY + window.innerHeight
    if (inside) surprisedUntil = performance.now() + 400
    lastCursor = p
  }
  trackLoop()

  const EYE_W = 6
  const EYE_H = 7
  const EYES = [3, 12] // левый край каждого глаза

  function openEye(x0, y0, w, h, pupil) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1)
      if (!corner) set(x0 + x, y0 + y)
    }
    // Зрачок — «дырка» из погасших точек
    const px = x0 + Math.round(((look.x + 1) / 2) * (w - pupil.w))
    const py = y0 + Math.round(((look.y + 1) / 2) * (h - pupil.h))
    for (let y = 0; y < pupil.h; y++) for (let x = 0; x < pupil.w; x++) set(px + x, py + y, 0)
  }

  function closedEye(x0, y0) {
    for (let x = 0; x < EYE_W; x++) set(x0 + x, y0 + EYE_H - 2)
  }

  // ^ ^ — радуемся
  function happyEye(x0, y0) {
    const base = y0 + 4
    for (let i = 0; i < 3; i++) {
      set(x0 + i, base - i)
      set(x0 + EYE_W - 1 - i, base - i)
    }
  }

  function sleepyEye(x0, y0) {
    for (let y = 4; y < EYE_H; y++) for (let x = 0; x < EYE_W; x++) {
      if (!((x === 0 || x === EYE_W - 1) && y === EYE_H - 1)) set(x0 + x, y0 + y)
    }
    set(x0 + 2, y0 + 5, 0)
    set(x0 + 3, y0 + 5, 0)
  }

  function mouth(y, kind) {
    if (kind === 'smile') {
      ;[7, 13].forEach((x) => set(x, y, 2))
      for (let x = 8; x <= 12; x++) set(x, y + 1, 2)
    } else if (kind === 'o') {
      for (let x = 9; x <= 11; x++) set(x, y, 2), set(x, y + 2, 2)
      set(8, y + 1, 2)
      set(12, y + 1, 2)
    } else {
      for (let x = 9; x <= 11; x++) set(x, y, 2)
    }
  }

  Widget.loop((t, dt) => {
    const now = performance.now()
    grid.fill(0)

    look.x += (target.x - look.x) * Math.min(1, dt * 10)
    look.y += (target.y - look.y) * Math.min(1, dt * 10)

    if (now > nextBlink) {
      blinkUntil = now + 200
      nextBlink = now + 2500 + Math.random() * 4000
    }

    const sleeping = now - idleSince > 30000
    const surprised = now < surprisedUntil
    const playing = Media.playing()
    // Под музыку глазки подпрыгивают в такт
    const bounce = playing ? Math.round(Math.abs(Math.sin(t * Math.PI * 2)) * 1) : 0
    const y0 = 5 - bounce

    for (const x0 of EYES) {
      if (surprised) openEye(x0 - 1, y0 - 1, EYE_W + 2, EYE_H + 2, { w: 2, h: 2 })
      else if (sleeping) sleepyEye(x0, y0)
      else if (now < blinkUntil) closedEye(x0, y0)
      else if (playing && Math.floor(t / 4) % 2) happyEye(x0, y0)
      else openEye(x0, y0, EYE_W, EYE_H, { w: 2, h: 3 })
    }
    mouth(15 - bounce, surprised ? 'o' : playing ? 'smile' : 'flat')

    // Спим — над головой плывут «z»
    if (sleeping) {
      const k = Math.floor(t * 1.5) % 3
      set(16 + k, 3 - k, 2)
    }

    // Отрисовка: круг из точек. Картинка пиксельная и меняется редко (моргнули, перевели взгляд) —
    // если ни одна точка не поменялась, холст не трогаем
    const { ctx, w, h } = Dot.fit(canvas)
    const colorsKey = Dot.css('--text') + Dot.css('--accent') + w + 'x' + h
    if (prevGrid && prevGrid.length === grid.length && prevKey === colorsKey && prevGrid.every((v, i) => v === grid[i])) return
    prevGrid = Uint8Array.from(grid)
    prevKey = colorsKey
    ctx.clearRect(0, 0, w, h)
    const size = Math.min(w, h)
    const pitch = size / N
    const ox = (w - size) / 2
    const oy = (h - size) / 2
    const c = (N - 1) / 2
    const colors = [Dot.css('--dot-off'), Dot.css('--text'), Dot.css('--accent')]
    const dots = Dot.batch(ctx)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (Math.hypot(x - c, y - c) > c + 0.3) continue
      const v = grid[y * N + x]
      dots.dot(ox + x * pitch + pitch / 2, oy + y * pitch + pitch / 2, pitch * (v ? 0.4 : 0.22), colors[v])
    }
    dots.flush()
    // Курсор двигается или играет музыка — 20 кадров; глаза в покое — 8 (хватит, чтобы моргнуть); спят — 4
  }, { fps: () => (performance.now() - idleSince > 30000 ? 4 : performance.now() - idleSince < 2000 ? 20 : Media.playing() ? 10 : 8) })
})
