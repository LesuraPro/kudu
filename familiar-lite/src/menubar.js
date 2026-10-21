const $ = (id) => document.getElementById(id)

// ---------- Меню слева ----------

for (const el of document.querySelectorAll('[data-menu]')) {
  el.addEventListener('click', () => window.familiar.menubarMenu(el.dataset.menu, el.getBoundingClientRect().left))
}
$('appName').addEventListener('click', () => window.familiar.toggleLauncher())
$('filesBtn').addEventListener('click', () => window.familiar.openFiles())

// Имя активного приложения, как в macOS
function showForeground(fg) {
  if (fg) $('appName').textContent = fg.name
}
window.familiar.getForeground().then(showForeground)
window.familiar.onForeground(showForeground)

// Аватар и имя текущего профиля; без фото — первая буква
function showProfile(config) {
  const p = config.profiles?.[config.profile] ?? { name: config.profile }
  const avatar = document.createElement('i')
  avatar.className = 'avatar'
  if (p.photo) avatar.style.backgroundImage = `url("${p.photo}")`
  else avatar.textContent = p.name.charAt(0).toUpperCase()
  $('profile').replaceChildren(avatar, document.createTextNode(p.name))
}
window.familiar.getConfig().then(showProfile)
window.familiar.onConfigChanged(showProfile)

// ---------- Музыка ----------

Media.onChange((m) => {
  $('now').classList.toggle('playing', Media.playing())
  $('nowText').textContent = Media.hasTrack() ? `${m.title} — ${m.artist}` : 'тишина'
  $('nowText').classList.toggle('muted', !Media.playing())
})
$('now').addEventListener('click', () => Media.cmd('toggle'))

// ---------- Нагрузка: мини-график ЦП за последнюю минуту ----------

const cpuHistory = []
function showStats(s) {
  cpuHistory.push(s.cpu)
  if (cpuHistory.length > 60) cpuHistory.shift()
  $('cpu').textContent = `${Math.round(s.cpu * 100)}%`
  $('mem').textContent = `${Math.round(s.mem * 100)}%`

  const { ctx, w, h } = Dot.fit($('cpuGraph'))
  ctx.clearRect(0, 0, w, h)
  // Столбики-точки: каждый замер — колонка из точек
  const cols = 17
  const rows = 6
  const pitch = w / cols
  const data = cpuHistory.slice(-cols)
  for (let x = 0; x < cols; x++) {
    const v = data[x - (cols - data.length)] ?? 0
    const lit = Math.round(v * rows)
    for (let y = 0; y < rows; y++) {
      const on = rows - y <= lit
      ctx.fillStyle = on ? (v > 0.85 ? Dot.css('--accent') : Dot.css('--text')) : Dot.css('--dot-off')
      ctx.beginPath()
      ctx.arc(x * pitch + pitch / 2, y * (h / rows) + h / rows / 2, pitch * 0.32, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
window.familiar.getStats().then(showStats)
window.familiar.onStats(showStats)

// ---------- Батарея ноутбука ----------

if (navigator.getBattery) {
  navigator.getBattery().then((b) => {
    const update = () => {
      const desktop = b.charging && b.level === 1 && b.chargingTime === 0
      $('battery').hidden = desktop
      const pct = Math.round(b.level * 100)
      $('battery').classList.toggle('low', pct <= 20 && !b.charging)
      $('battery').querySelector('b').style.width = `${pct}%`
      $('batteryText').textContent = `${pct}%${b.charging ? '⚡' : ''}`
    }
    update()
    b.addEventListener('levelchange', update)
    b.addEventListener('chargingchange', update)
  })
}

// ---------- Часы ----------

function tick() {
  const now = new Date()
  const date = now.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  $('clock').textContent = `${date} ${time}`
}
tick()
setInterval(tick, 1000)
$('clock').addEventListener('click', () => window.familiar.toggleWidgets())
