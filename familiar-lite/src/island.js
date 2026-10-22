const island = document.getElementById('island')
const $ = (id) => document.getElementById(id)

// ---------- Раскрытие при наведении ----------

let openTimer
island.addEventListener('mouseenter', () => {
  window.familiar.captureMouse(true)
  clearTimeout(openTimer)
  openTimer = setTimeout(() => island.classList.add('open'), 120)
})
island.addEventListener('mouseleave', () => {
  clearTimeout(openTimer)
  island.classList.remove('open')
  window.familiar.captureMouse(false)
})
island.addEventListener('click', () => island.classList.add('open'))

// Вкладки «Музыка / Устройства»
for (const tab of document.querySelectorAll('.tabs button')) {
  tab.addEventListener('click', (e) => {
    e.stopPropagation()
    document.querySelectorAll('.tabs button, .page').forEach((el) => el.classList.remove('active'))
    tab.classList.add('active')
    $(tab.dataset.page).classList.add('active')
  })
}

// ---------- Плеер ----------

$('prev').addEventListener('click', () => Media.cmd('prev'))
$('play').addEventListener('click', () => Media.cmd('toggle'))
$('next').addEventListener('click', () => Media.cmd('next'))

const PLAY = 'M7 5v14l12-7z'
const PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z'

let shownArt = null
let shownKey = null
Media.onChange((m) => {
  // Новый трек: обложка переворачивается, название въезжает
  if (shownKey !== null && m.key !== shownKey) {
    const track = document.querySelector('.track')
    track.classList.remove('swap')
    void track.offsetWidth
    track.classList.add('swap')
  }
  shownKey = m.key
  const has = Media.hasTrack()
  island.classList.toggle('playing', Media.playing())
  $('app').textContent = has ? Media.appName() : '—'
  $('title').textContent = has ? m.title : 'Ничего не играет'
  $('artist').textContent = has ? m.artist || m.album || '' : 'Включи музыку в любом плеере'
  $('playIcon').setAttribute('d', Media.playing() ? PAUSE : PLAY)
  $('dur').textContent = Media.fmt(m.duration)

  // Обложку трогаем только при смене: иначе браузер заново декодирует картинку
  const art = has && m.art ? m.art : ''
  if (art !== shownArt) {
    shownArt = art
    const css = art ? `url("${art}")` : ''
    $('art').style.backgroundImage = css
    $('artDots').style.display = art ? 'none' : ''
    $('miniArt').style.backgroundImage = css
    $('miniArt').classList.toggle('empty', !art)
  }
})

// ---------- Нижняя строка ----------

function updateFooter(config) {
  const today = new Date().toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })
  $('date').textContent = today.toUpperCase()
  const left = (config.reminders ?? []).filter((r) => !r.done).length
  $('remindersBtn').textContent = `☰ НАПОМИНАНИЯ · ${left}`
}
window.familiar.getConfig().then(updateFooter)
window.familiar.onConfigChanged(updateFooter)
$('remindersBtn').addEventListener('click', () => window.familiar.toggleWidgets())

// ---------- Устройства ----------

// Пять «ячеек» заряда; при 20% и меньше — красные
function cells(level) {
  const pct = Math.round(level * 100)
  const box = document.createElement('div')
  box.className = 'cells'
  for (let i = 0; i < 5; i++) {
    const el = document.createElement('i')
    if (i < Math.ceil(level * 5)) el.className = pct <= 20 ? 'low' : 'on'
    box.appendChild(el)
  }
  return box
}

async function initBattery() {
  if (!navigator.getBattery) return
  const b = await navigator.getBattery()
  const update = () => {
    const pct = Math.round(b.level * 100)
    const desktop = b.charging && b.level === 1 && b.chargingTime === 0
    document.querySelector('#battery .cells').replaceWith(cells(b.level))
    $('batteryText').textContent = desktop ? 'Питание от сети' : `${pct}%${b.charging ? ' · заряжается' : ''}`
  }
  update()
  b.addEventListener('levelchange', update)
  b.addEventListener('chargingchange', update)
}
initBattery()

function showDevices(list) {
  $('btDevices').replaceChildren(
    ...list.map((d) => {
      const row = document.createElement('div')
      row.className = 'device'
      const text = document.createElement('div')
      const name = document.createElement('div')
      name.textContent = d.name
      const small = document.createElement('small')
      small.textContent = `${d.battery}% · Bluetooth`
      text.append(name, small)
      row.append(cells(d.battery / 100), text)
      return row
    })
  )
}
window.familiar.getDevices().then(showDevices)
window.familiar.onDevices(showDevices)

$('theme').addEventListener('click', (e) => {
  e.stopPropagation()
  window.familiar.toggleTheme()
})

// ---------- Анимация: точечные часы / бегущая строка ----------

const mini = $('miniDots')
const artDots = $('artDots')
const PITCH = 2
// Цвета острова — «чернила» и «лунный свет» из палитры (см. theme.css: --ink-*)
const ON = () => Dot.css('--ink-text')
const inkAlpha = (a) => {
  const n = parseInt(ON().slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
const OFF = () => inkAlpha(0.08)
// Сменилась палитра — заготовленные полоски перерисуем новыми цветами
window.addEventListener('familiar-palette', () => (strip = backdrop = null))

// Нарисовать что-то один раз в отдельный canvas, чтобы потом только копировать картинкой
function offscreen(width, height, draw) {
  const dpr = window.devicePixelRatio || 1
  const c = document.createElement('canvas')
  c.width = Math.ceil(width * dpr)
  c.height = Math.ceil(height * dpr)
  const ctx = c.getContext('2d')
  ctx.scale(dpr, dpr)
  draw(ctx)
  return c
}

// Строка трека и фон из погасших точек рисуются один раз на трек / размер,
// а на каждом кадре только сдвигаются — вместо сотен кружочков за кадр
let strip = null
function textStrip(text) {
  if (strip?.text !== text) {
    const width = Dot.width(text) * PITCH
    strip = { text, width, canvas: offscreen(width, 7 * PITCH, (ctx) => Dot.draw(ctx, text, 0, 0, { pitch: PITCH, on: ON() })) }
  }
  return strip
}

let backdrop = null
function dotsBackdrop(width) {
  if (backdrop?.width !== width) {
    backdrop = {
      width,
      canvas: offscreen(width, 7 * PITCH, (ctx) => {
        ctx.fillStyle = OFF()
        for (let x = 0; x < width; x += PITCH) for (let y = 0; y < 7; y++) {
          ctx.beginPath()
          ctx.arc(x + PITCH / 2, y * PITCH + PITCH / 2, PITCH * 0.36, 0, Math.PI * 2)
          ctx.fill()
        }
      })
    }
  }
  return backdrop
}

let scroll = 0
let lastDraw = 0
let shownTime = ''

// Пока остров свёрнут и музыки нет, показывать нечего, кроме часов — 2 кадра в секунду хватит.
// Между кадрами ждём таймером: висящий requestAnimationFrame заставляет Chromium
// крутить полный цикл кадра 60 раз в секунду, даже если рисовать нечего
function scheduleFrame() {
  // В паузе (игра на весь экран) — только часы раз в 2 секунды; в экономии — вдвое меньше кадров
  const busy = island.classList.contains('open') || Media.playing()
  const fps = Power.mode() === 'paused' ? 0.5 : (busy ? 30 : 2) * Power.factor()
  const wait = 1000 / fps - (performance.now() - lastDraw)
  if (wait > 8) setTimeout(() => requestAnimationFrame(frame), wait - 4)
  else requestAnimationFrame(frame)
}

function frame(now) {
  const dt = Math.min(0.1, (now - lastDraw) / 1000)
  lastDraw = now
  draw(now, dt)
  scheduleFrame()
}

function draw(now, dt) {
  const open = island.classList.contains('open')
  const playing = Media.playing()

  // Свёрнутый остров: если играет музыка — бегущая строка, иначе часы
  const { ctx, w, h } = Dot.fit(mini)
  if (playing) {
    const m = Media.get()
    const s = textStrip(`${m.title} — ${m.artist}   `.toUpperCase())
    scroll = (scroll + dt * 30) % s.width
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(dotsBackdrop(Math.ceil(w)).canvas, 0, 0, Math.ceil(w), 7 * PITCH)
    // Текст дважды подряд — строка получается бесконечной
    ctx.drawImage(s.canvas, -scroll, 0, s.width, 7 * PITCH)
    ctx.drawImage(s.canvas, s.width - scroll, 0, s.width, 7 * PITCH)
    shownTime = ''
  } else {
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    // Часы перерисовываем раз в минуту (или если canvas поменял размер и очистился)
    if (time !== shownTime || mini.dataset.w !== String(w)) {
      shownTime = time
      mini.dataset.w = String(w)
      ctx.clearRect(0, 0, w, h)
      const tw = Dot.width(time) * PITCH
      Dot.draw(ctx, time, (w - tw) / 2, 0, { pitch: PITCH, on: ON(), off: OFF() })
    }
  }

  if (!open) return

  // Заглушка вместо обложки: пульсирующая точечная сетка
  if (artDots.style.display !== 'none') {
    const a = Dot.fit(artDots)
    a.ctx.clearRect(0, 0, a.w, a.h)
    const n = 7
    const p = a.w / n
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - 3, y - 3)
      const b = playing ? 0.5 + 0.5 * Math.sin(now / 250 - d * 1.3) : d < 1 ? 1 : 0.15
      a.ctx.fillStyle = d < 0.5 ? Dot.css('--accent') : inkAlpha(0.1 + b * 0.8)
      a.ctx.beginPath()
      a.ctx.arc(x * p + p / 2, y * p + p / 2, p * 0.32, 0, Math.PI * 2)
      a.ctx.fill()
    }
  }

  // Прогресс трека
  $('fill').style.width = `${Media.progress() * 100}%`
  const pos = Media.fmt(Media.position())
  if ($('pos').textContent !== pos) $('pos').textContent = pos
}
scheduleFrame()
