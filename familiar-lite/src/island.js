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

Media.onChange((m) => {
  const has = Media.hasTrack()
  island.classList.toggle('playing', Media.playing())
  $('app').textContent = has ? Media.appName() : '—'
  $('title').textContent = has ? m.title : 'Ничего не играет'
  $('artist').textContent = has ? m.artist || m.album || '' : 'Включи музыку в любом плеере'
  $('playIcon').setAttribute('d', Media.playing() ? PAUSE : PLAY)
  $('dur').textContent = Media.fmt(m.duration)

  const art = has && m.art ? `url("${m.art}")` : ''
  $('art').style.backgroundImage = art
  $('artDots').style.display = art ? 'none' : ''
  $('miniArt').style.backgroundImage = art
  $('miniArt').classList.toggle('empty', !art)
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

async function initBattery() {
  if (!navigator.getBattery) return
  const b = await navigator.getBattery()
  const update = () => {
    const pct = Math.round(b.level * 100)
    const desktop = b.charging && b.level === 1 && b.chargingTime === 0
    const cells = document.querySelector('#battery .cells')
    cells.replaceChildren(
      ...Array.from({ length: 5 }, (_, i) => {
        const el = document.createElement('i')
        if (i < Math.ceil(b.level * 5)) el.className = pct <= 20 ? 'low' : 'on'
        return el
      })
    )
    $('batteryText').textContent = desktop ? 'Питание от сети' : `${pct}%${b.charging ? ' · заряжается' : ''}`
  }
  update()
  b.addEventListener('levelchange', update)
  b.addEventListener('chargingchange', update)
}
initBattery()
$('audioSource').textContent = navigator.platform.startsWith('Win') ? 'Системный медиаплеер Windows' : 'Демо-режим'

// ---------- Анимация: точечные часы / бегущая строка ----------

const mini = $('miniDots')
const artDots = $('artDots')
let scroll = 0
let last = performance.now()

function frame(now) {
  const dt = (now - last) / 1000
  last = now

  // Свёрнутый остров: если играет музыка — бегущая строка, иначе часы
  const { ctx, w, h } = Dot.fit(mini)
  ctx.clearRect(0, 0, w, h)
  const pitch = 3
  const on = '#f2f2f2'
  const off = 'rgba(255,255,255,0.08)'
  if (Media.playing()) {
    const m = Media.get()
    const text = `${m.title} — ${m.artist}   `.toUpperCase()
    const tw = Dot.width(text) * pitch
    scroll = (scroll + dt * 30) % tw
    // Фон из погасших точек, поверх — текст дважды, чтобы строка была бесконечной
    for (let x = 0; x < w; x += pitch) for (let y = 0; y < 7; y++) {
      ctx.fillStyle = off
      ctx.beginPath()
      ctx.arc(x + pitch / 2, y * pitch + pitch / 2, pitch * 0.36, 0, Math.PI * 2)
      ctx.fill()
    }
    Dot.draw(ctx, text, -scroll, 0, { pitch, on })
    Dot.draw(ctx, text, tw - scroll, 0, { pitch, on })
  } else {
    const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    const tw = Dot.width(time) * pitch
    Dot.draw(ctx, time, (w - tw) / 2, 0, { pitch, on, off })
  }

  // Заглушка вместо обложки: пульсирующая точечная сетка
  if (artDots.style.display !== 'none' && island.classList.contains('open')) {
    const a = Dot.fit(artDots)
    a.ctx.clearRect(0, 0, a.w, a.h)
    const n = 7
    const p = a.w / n
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - 3, y - 3)
      const b = Media.playing() ? 0.5 + 0.5 * Math.sin(now / 250 - d * 1.3) : d < 1 ? 1 : 0.15
      a.ctx.fillStyle = d < 0.5 ? Dot.css('--accent') : `rgba(255,255,255,${0.1 + b * 0.8})`
      a.ctx.beginPath()
      a.ctx.arc(x * p + p / 2, y * p + p / 2, p * 0.32, 0, Math.PI * 2)
      a.ctx.fill()
    }
  }

  // Прогресс трека
  if (island.classList.contains('open')) {
    $('fill').style.width = `${Media.progress() * 100}%`
    $('pos').textContent = Media.fmt(Media.position())
  }

  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
