// Пример своего виджета: таймер Помодоро (25 минут работа / 5 минут отдых).
//
// Как сделать свой виджет:
//   1. Положи .js-файл в папку %APPDATA%\familiar-lite\widgets\
//      (ПКМ по доку → Виджеты → «Папка своих виджетов…»)
//   2. ПКМ по доку → Виджеты → «Обновить свои виджеты» — он появится в списке
//   3. Имя в Widget.define(...) должно совпадать с именем файла без .js
//
// Что доступно внутри:
//   Widget.define(name, (card) => {...})  — card: пустой блок виджета, клади туда что угодно
//   Widget.loop((t, dt) => {...})         — анимация: t — секунды, dt — сколько прошло с прошлого кадра
//   Widget.el(tag, className, text)       — быстро создать элемент
//   Dot.draw(ctx, text, x, y, { pitch })  — текст точечным шрифтом на canvas, Dot.fit(canvas) — подготовить canvas
//   Dot.css('--accent')                   — цвета темы: --text, --muted, --accent, --dot-off
//   Media.get(), Media.playing()          — что играет; Media.cmd('toggle' | 'next' | 'prev')
//   Sound.level()                         — громкость 0…1 (после Sound.start() и Sound.update(t) в цикле)
//   window.familiar.*                     — всё из preload.js: запуск приложений, погода, нагрузка и т.д.
//   Кнопкам и полям ввода дай класс или они не будут кликаться: окно перетаскивается за любое место,
//   кроме button, input, li и canvas.click.

Widget.define('pomodoro', (card) => {
  const WORK = 25 * 60
  const BREAK = 5 * 60

  const label = Widget.el('div', 'label', 'Помодоро')
  const canvas = Widget.el('canvas')
  canvas.style.cssText = 'flex: 1; min-height: 0; width: 100%;'
  const buttons = Widget.el('div')
  buttons.style.cssText = 'display: flex; gap: 6px; justify-content: center;'
  const startBtn = Widget.el('button', '', 'Старт')
  const resetBtn = Widget.el('button', '', 'Сброс')
  for (const b of [startBtn, resetBtn]) {
    b.style.cssText = 'padding: 4px 12px; font-size: 11px; border: 1px solid var(--border); border-radius: 999px;'
    buttons.appendChild(b)
  }
  card.append(label, canvas, buttons)

  let phase = 'work'
  let left = WORK
  let running = false

  startBtn.addEventListener('click', () => {
    running = !running
    startBtn.textContent = running ? 'Пауза' : 'Старт'
  })
  resetBtn.addEventListener('click', () => {
    running = false
    phase = 'work'
    left = WORK
    startBtn.textContent = 'Старт'
  })

  Widget.loop((t, dt) => {
    if (running) {
      left -= dt
      if (left <= 0) {
        phase = phase === 'work' ? 'break' : 'work'
        left = phase === 'work' ? WORK : BREAK
        new Notification(phase === 'work' ? 'Перерыв окончен' : 'Время отдохнуть', {
          body: phase === 'work' ? 'Погнали, 25 минут фокуса' : '5 минут: встань, разомнись, попей воды'
        })
      }
    }
    label.textContent = phase === 'work' ? 'Помодоро · работа' : 'Помодоро · отдых'

    const { ctx, w, h } = Dot.fit(canvas)
    ctx.clearRect(0, 0, w, h)
    const total = phase === 'work' ? WORK : BREAK
    const accent = Dot.css('--accent')
    const on = Dot.css('--text')
    const off = Dot.css('--dot-off')

    // Кольцо прогресса из 48 точек
    const cx = w / 2
    const cy = h / 2
    const R = Math.min(w, h) / 2 - 6
    const done = 1 - left / total
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2 - Math.PI / 2
      ctx.fillStyle = i / 48 < done ? (phase === 'work' ? accent : on) : off
      ctx.beginPath()
      ctx.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 2.4, 0, Math.PI * 2)
      ctx.fill()
    }

    const sec = Math.max(0, Math.ceil(left))
    const text = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
    const pitch = Math.max(3, Math.floor((R * 1.3) / Dot.width(text)))
    // На паузе цифры мигают
    const blink = !running && left < total && Math.floor(t * 2) % 2
    Dot.draw(ctx, text, cx - (Dot.width(text) * pitch) / 2, cy - 3.5 * pitch, { pitch, on: blink ? off : on, off })
  })
})
