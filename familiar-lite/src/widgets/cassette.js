// Кассета: бобины крутятся, пока играет музыка, плёнка перематывается
// слева направо по ходу трека. Клик по кассете — пауза/играть.
Widget.define('cassette', (card) => {
  const canvas = Widget.el('canvas', 'click')
  canvas.title = 'Пауза / играть'
  canvas.addEventListener('click', () => Media.cmd('toggle'))

  const pill = Widget.el('div', 'pill')
  const marquee = Widget.el('div', 'marquee')
  const marqueeText = Widget.el('span')
  marquee.appendChild(marqueeText)
  pill.append(Widget.el('i', 'dot'), marquee)

  const foot = Widget.el('div', 'foot')
  const counter = Widget.el('canvas')
  const state = Widget.el('div', 'state')
  foot.append(counter, state)
  card.append(canvas, pill, foot)
  // Строка едет только под музыку: на паузе кассета рисует 4 кадра, рывки были бы заметны
  const scrollText = Dot.marquee(marquee, marqueeText)

  Media.onChange((m) => {
    marqueeText.textContent = Media.hasTrack() ? `Now playing · ${m.title} — ${m.artist}` : 'Вставьте кассету · ничего не играет'
    pill.classList.toggle('live', Media.playing())
  })

  const fontFamily = getComputedStyle(document.body).fontFamily
  let angleL = 0
  let angleR = 0
  // Скорость плавно разгоняется и тормозит, как у настоящего магнитофона
  let speed = 0

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
  }

  // Смешать два цвета #rrggbb: k = 0 — первый, 1 — второй
  function mix(a, b, k) {
    const pa = parseInt(a.slice(1), 16)
    const pb = parseInt(b.slice(1), 16)
    const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k)
    return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
  }

  function reel(ctx, x, y, tapeR, hubR, angle, on, tape, line, accent) {
    // Намотанная плёнка — тёмно-винная, как тень клинка
    ctx.fillStyle = tape
    ctx.beginPath()
    ctx.arc(x, y, tapeR, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = line
    for (let r = hubR + 4; r < tapeR; r += 3) {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.stroke()
    }
    // Белое кольцо вокруг втулки
    ctx.strokeStyle = on
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(x, y, hubR, 0, Math.PI * 2)
    ctx.stroke()
    ctx.lineWidth = 1
    // Шесть зубцов втулки
    ctx.fillStyle = on
    for (let i = 0; i < 6; i++) {
      const a = angle + (i * Math.PI) / 3
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(a)
      ctx.fillRect(-1.5, -hubR + 3, 3, hubR * 0.45)
      ctx.restore()
    }
    ctx.fillStyle = accent
    ctx.beginPath()
    ctx.arc(x, y, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }

  Widget.loop((t, dt) => {
    if (Media.playing()) scrollText(dt)
    const { ctx, w, h } = Dot.fit(canvas)
    // Кассета — тёмный «физический» предмет: от светлой темы не зависит, но цвета —
    // из палитры (тушь, лунный свет, клинок). Цвета темы — только для счётчика под ней
    const on = Dot.css('--text')
    const off = Dot.css('--dot-off')
    const accent = Dot.css('--accent')
    const INK = Dot.css('--ink-text')
    const INK_MUTED = Dot.css('--ink-dim')
    const SCREW = Dot.css('--ink-line')
    const BODY = mix(Dot.css('--ink'), INK, 0.07)
    const TAPE = mix(Dot.css('--ink'), accent, 0.3)
    ctx.clearRect(0, 0, w, h)

    // Корпус
    const bw = Math.min(w - 4, h * 1.6)
    const bh = bw / 1.6
    const bx = (w - bw) / 2
    const by = (h - bh) / 2
    roundRect(ctx, bx, by, bw, bh, 14)
    ctx.fillStyle = BODY
    ctx.fill()
    ctx.strokeStyle = SCREW
    ctx.stroke()
    // Винтики по углам
    ctx.fillStyle = SCREW
    for (const [sx, sy] of [[10, 10], [bw - 10, 10], [10, bh - 10], [bw - 10, bh - 10]]) {
      ctx.beginPath()
      ctx.arc(bx + sx, by + sy, 3, 0, Math.PI * 2)
      ctx.fill()
    }

    // Наклейка: сторона «A» и название трека
    const m = Media.get()
    ctx.fillStyle = INK
    ctx.font = `700 ${Math.round(bh * 0.16)}px ${fontFamily}`
    ctx.fillText('A', bx + 22, by + bh * 0.24)
    ctx.font = `600 ${Math.round(bh * 0.075)}px ${fontFamily}`
    ctx.fillText((Media.hasTrack() ? m.title : 'familiar mixtape').slice(0, 28), bx + 22 + bh * 0.16, by + bh * 0.16)
    ctx.fillStyle = INK_MUTED
    ctx.font = `${Math.round(bh * 0.06)}px ${fontFamily}`
    ctx.fillText((Media.hasTrack() ? m.artist : 'side a · 60 min').slice(0, 32), bx + 22 + bh * 0.16, by + bh * 0.25)

    // Окошко с бобинами
    const wx = bx + bw * 0.12
    const wy = by + bh * 0.33
    const ww = bw * 0.76
    const wh = bh * 0.48
    roundRect(ctx, wx, wy, ww, wh, wh / 2)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fill()

    const p = Media.progress()
    const hubR = wh * 0.24
    const maxR = wh * 0.46
    const tapeL = hubR + (maxR - hubR) * (1 - p)
    const tapeR = hubR + (maxR - hubR) * p
    const target = Media.playing() ? 1 : 0
    speed += (target - speed) * Math.min(1, dt * 3)
    // Чем меньше намотано плёнки, тем быстрее крутится бобина
    angleL += dt * speed * 3 * (maxR / tapeL)
    angleR += dt * speed * 3 * (maxR / Math.max(tapeR, hubR))
    const cy = wy + wh / 2
    reel(ctx, wx + ww * 0.25, cy, tapeL, hubR, angleL, INK, TAPE, SCREW, accent)
    reel(ctx, wx + ww * 0.75, cy, Math.max(tapeR, hubR), hubR, angleR, INK, TAPE, SCREW, accent)

    // Счётчик времени точками
    const c = Dot.fit(counter)
    c.ctx.clearRect(0, 0, c.w, c.h)
    const sec = Math.floor(Media.position())
    const time = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
    Dot.draw(c.ctx, time, 0, 0, { pitch: c.h / 7, on, off })
    Widget.text(state, Media.playing() ? 'PLAY ▸' : Media.hasTrack() ? 'PAUSE ‖' : 'STOP ■')
    // Бобины стоят (пауза) — счётчик и так не меняется, хватит 4 кадров
  }, { fps: () => (Media.playing() || speed > 0.01 ? 24 : 4) })
})
