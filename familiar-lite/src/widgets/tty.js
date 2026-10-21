// familiar-tty: терминал со сценами 1 fetch · 2 cave · 3 life · 4 orb · 5 rain.
// Переключение — кнопками внизу или клавишами 1–5 (когда окно в фокусе).
Widget.define('tty', (card) => {
  const SCENES = ['fetch', 'cave', 'life', 'orb', 'rain']
  let scene = SCENES.includes(localStorage.ttyScene) ? localStorage.ttyScene : 'fetch'

  const titlebar = Widget.el('div', 'titlebar')
  const title = Widget.el('span')
  titlebar.append(Widget.el('i'), Widget.el('i'), Widget.el('i'), title)
  const canvas = Widget.el('canvas')
  const tabs = Widget.el('div', 'tabs')
  SCENES.forEach((s, i) => {
    const b = Widget.el('button', '', `${i + 1} ${s}`)
    b.addEventListener('click', () => select(s))
    tabs.appendChild(b)
  })
  card.append(titlebar, canvas, tabs)

  function select(s) {
    scene = s
    try {
      localStorage.ttyScene = s
    } catch {}
    tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', SCENES[i] === s))
    state = {}
  }

  document.addEventListener('keydown', (e) => {
    const i = Number(e.key) - 1
    if (SCENES[i]) select(SCENES[i])
  })

  // ---------- Экран из символов ----------

  const FONT = 13
  let cols = 0
  let rows = 0
  let chars = []
  let colors = []
  let cw = 8
  let ch = 16
  let state = {}
  const C = { text: '#e8e8e8', dim: '#55555b', mid: '#9a9aa0', red: '#ff2d2d', dark: '#2a2a2e' }

  const clear = () => {
    chars = Array.from({ length: rows }, () => Array(cols).fill(' '))
    colors = Array.from({ length: rows }, () => Array(cols).fill(C.text))
  }
  const put = (x, y, s, color = C.text) => {
    s = String(s)
    for (let i = 0; i < s.length; i++) {
      const cx = x + i
      if (cx >= 0 && cx < cols && y >= 0 && y < rows) {
        chars[y][cx] = s[i]
        colors[y][cx] = color
      }
    }
  }

  // ---------- Сцены ----------

  let info = null
  const started = Date.now()
  window.familiar.sysinfo().then((i) => (info = i))
  setInterval(() => window.familiar.sysinfo().then((i) => (info = i)), 5000)

  const gb = (b) => (b / 1024 ** 3).toFixed(1)
  const dur = (s) => {
    s = Math.floor(s)
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ')
  }

  const scenes = {
    // Как neofetch/fastfetch: логотип из точек + сведения о системе
    fetch(t) {
      const logo = Dot.glyph('F').map((r) => [...r].map((c) => (c === '#' ? '● ' : '  ')).join(''))
      const lx = 2
      const ly = 2
      logo.forEach((line, i) => put(lx, ly + i, line, C.text))
      // Мигающий красный блок, как индикатор записи
      if (Math.floor(t * 2) % 2) put(lx + 6, ly + 5, '■■', C.red), put(lx + 6, ly + 6, '■■', C.red)

      const run = Math.floor((Date.now() - started) / 1000)
      const timer = [Math.floor(run / 3600), Math.floor((run % 3600) / 60), run % 60].map((n) => String(n).padStart(2, '0')).join(':')
      put(lx, ly + 9, timer, C.mid)

      if (!info) return put(16, 2, 'loading…', C.dim)
      const m = Media.get()
      const lines = [
        ['OS', `${info.os} ${info.arch}`],
        ['Host', info.host],
        ['Shell', 'familiar-tty'],
        ['WM', 'familiar-lite (dock + island)'],
        ['Display', info.resolution],
        ['CPU', `${info.cpu} (${info.cores})`],
        ['Memory', `${gb(info.memTotal - info.memFree)} / ${gb(info.memTotal)} GiB`],
        ['Uptime', dur(info.uptime)],
        ['Runtime', `electron ${info.electron}`],
        ['Music', Media.hasTrack() ? `${m.title} — ${m.artist}` : '—']
      ]
      const x = 22
      put(x, 1, `${info.user}@familiar`, C.red)
      put(x, 2, '─'.repeat(Math.min(cols - x - 1, info.user.length + 9)), C.dim)
      lines.forEach(([k, v], i) => {
        put(x, 3 + i, k.padEnd(9), C.red)
        put(x + 9, 3 + i, v.slice(0, Math.max(0, cols - x - 10)), C.text)
      })
      // Палитра
      const palette = ['#ff2d2d', '#e8e8e8', '#9a9aa0', '#55555b', '#2a2a2e', '#ff8a8a']
      palette.forEach((c, i) => put(x + i * 3, 4 + lines.length, '██', c))
      // Мигающий курсор в «командной строке»
      const prompt = `${info.user}@familiar:~$ fastfetch --logo familiar `
      put(0, rows - 1, prompt, C.mid)
      if (Math.floor(t * 2) % 2) put(prompt.length, rows - 1, '█', C.text)
    },

    // Полёт сквозь пещеру: стены — случайное блуждание, сбоку летит кораблик
    cave(t, dt) {
      if (!state.walls) {
        state.walls = []
        state.top = 3
        state.gap = Math.floor(rows * 0.55)
        state.acc = 0
        for (let i = 0; i < cols; i++) state.walls.push(next())
      }
      function next() {
        state.top = Math.max(1, Math.min(rows - state.gap - 2, state.top + Math.round(Math.random() * 2 - 1)))
        state.gap = Math.max(Math.floor(rows * 0.35), Math.min(rows - 4, state.gap + Math.round(Math.random() * 2 - 1)))
        return { top: state.top, bottom: state.top + state.gap, star: Math.random() < 0.08 ? Math.floor(Math.random() * rows) : -1 }
      }
      state.acc += dt * 24
      while (state.acc >= 1) {
        state.walls.shift()
        state.walls.push(next())
        state.acc -= 1
      }
      while (state.walls.length < cols) state.walls.push(next())
      state.walls.forEach((w, x) => {
        for (let y = 0; y < rows; y++) {
          if (y < w.top || y > w.bottom) put(x, y, y === w.top - 1 || y === w.bottom + 1 ? '▓' : '░', y === w.top - 1 || y === w.bottom + 1 ? C.mid : C.dark)
          else if (y === w.star) put(x, y, '·', C.dim)
        }
      })
      // Кораблик держится середины прохода
      const shipX = 8
      const w = state.walls[shipX]
      const y = Math.round((w.top + w.bottom) / 2 + Math.sin(t * 2) * 1.5)
      put(shipX - 3, y, '=', C.red)
      put(shipX - 2, y, '-', C.red)
      put(shipX - 1, y, '[', C.text)
      put(shipX, y, '>', C.text)
    },

    // Игра «Жизнь» Конвея: рождённые клетки — красные
    life() {
      if (!state.cells || state.w !== cols || state.h !== rows) {
        state.w = cols
        state.h = rows
        state.cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => Math.random() < 0.28))
        state.age = Array.from({ length: rows }, () => Array(cols).fill(0))
        state.frame = 0
        state.gen = 0
      }
      if (state.frame++ % 3 === 0) {
        const next = state.cells.map((row, y) =>
          row.map((alive, x) => {
            let n = 0
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              if (dx || dy) n += state.cells[(y + dy + rows) % rows][(x + dx + cols) % cols] ? 1 : 0
            }
            return alive ? n === 2 || n === 3 : n === 3
          })
        )
        next.forEach((row, y) => row.forEach((alive, x) => (state.age[y][x] = alive ? state.age[y][x] + 1 : 0)))
        state.cells = next
        // Раз в ~300 поколений — новая «вселенная», чтобы не застывало
        if (++state.gen > 300) state.cells = null
      }
      state.cells?.forEach((row, y) =>
        row.forEach((alive, x) => alive && put(x, y, '●', state.age[y][x] <= 1 ? C.red : state.age[y][x] < 6 ? C.text : C.mid))
      )
      put(cols - 12, rows - 1, ` gen ${String(state.gen).padStart(4)} `, C.dim)
    },

    // Вращающаяся планета из ASCII-символов с освещением
    orb(t) {
      const ramp = ' .:-=+*#%@'
      const cx = cols / 2
      const cy = rows / 2
      const R = Math.min(rows / 2 - 1, cols / 4 - 1) // символы в 2 раза выше, чем шире
      // Свет гуляет слева направо, но всегда спереди — иначе шар уходит в тень
      const L = [Math.cos(t * 0.6) * 0.9, -0.45, 0.65]
      const len = Math.hypot(...L)
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const nx = (x - cx) / (R * 2)
        const ny = (y - cy) / R
        const d = nx * nx + ny * ny
        if (d > 1) continue
        const nz = Math.sqrt(1 - d)
        const light = 0.12 + 0.88 * Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / len)
        // Полосы «материков» крутятся вместе с планетой
        const lon = Math.atan2(nx, nz) + t * 0.8
        const lat = Math.asin(ny)
        const land = Math.sin(lon * 3) * Math.cos(lat * 4) > 0.2 ? 1 : 0.55
        const v = light * land
        const c = ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))]
        put(x, y, c, d > 0.9 ? C.red : v > 0.7 ? C.text : C.mid)
      }
    },

    // «Матрица»: падающие символы, голова капли — красная
    rain(t, dt) {
      const glyphs = '01アイウエオカキクケコサシスセソタチツテトナニヌネノ#$%&*+=<>'
      if (!state.drops || state.w !== cols) {
        state.w = cols
        state.drops = Array.from({ length: cols }, () => ({ y: Math.random() * -rows, v: 6 + Math.random() * 14, len: 4 + Math.floor(Math.random() * 12) }))
        state.trail = Array.from({ length: rows }, () => Array(cols).fill(''))
      }
      state.drops.forEach((d, x) => {
        d.y += d.v * dt
        const head = Math.floor(d.y)
        if (head >= 0 && head < rows && Math.random() < 0.9) state.trail[head][x] = glyphs[Math.floor(Math.random() * glyphs.length)]
        for (let k = 0; k <= d.len; k++) {
          const y = head - k
          if (y < 0 || y >= rows || !state.trail[y][x]) continue
          put(x, y, state.trail[y][x], k === 0 ? C.red : k < 3 ? C.text : k < d.len / 2 ? C.mid : C.dim)
        }
        if (head - d.len > rows) Object.assign(d, { y: Math.random() * -10, v: 6 + Math.random() * 14 })
      })
    }
  }

  select(scene)

  Widget.loop((t, dt) => {
    const { ctx, w, h } = Dot.fit(canvas)
    ctx.font = `${FONT}px ${getComputedStyle(document.body).fontFamily}`
    cw = ctx.measureText('M').width
    ch = Math.round(FONT * 1.3)
    const pad = 10
    const c = Math.max(10, Math.floor((w - pad * 2) / cw))
    const r = Math.max(5, Math.floor((h - pad * 2) / ch))
    if (c !== cols || r !== rows) {
      cols = c
      rows = r
      state = {}
    }
    clear()
    scenes[scene](t, dt)
    title.textContent = `${info?.user ?? 'user'}@familiar: ~ — ${scene}`

    ctx.clearRect(0, 0, w, h)
    ctx.textBaseline = 'top'
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const s = chars[y][x]
      if (s === ' ') continue
      ctx.fillStyle = colors[y][x]
      ctx.fillText(s, pad + x * cw, pad + y * ch)
    }
  })
})
