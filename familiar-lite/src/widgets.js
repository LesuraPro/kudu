// ---------- Часы ----------

function tick() {
  const now = new Date()
  document.getElementById('time').textContent = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  document.getElementById('date').textContent = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
}
tick()
setInterval(tick, 1000)

// ---------- Погода (Open-Meteo, коды WMO) ----------

const WMO = {
  0: 'Ясно', 1: 'Преимущественно ясно', 2: 'Переменная облачность', 3: 'Пасмурно',
  45: 'Туман', 48: 'Изморозь', 51: 'Лёгкая морось', 53: 'Морось', 55: 'Сильная морось',
  61: 'Небольшой дождь', 63: 'Дождь', 65: 'Ливень', 66: 'Ледяной дождь', 67: 'Ледяной дождь',
  71: 'Небольшой снег', 73: 'Снег', 75: 'Сильный снег', 77: 'Снежная крупа',
  80: 'Ливневый дождь', 81: 'Ливневый дождь', 82: 'Сильный ливень',
  85: 'Снегопад', 86: 'Сильный снегопад', 95: 'Гроза', 96: 'Гроза с градом', 99: 'Гроза с градом'
}

async function loadWeather(config) {
  document.getElementById('city').textContent = config.weather.city
  try {
    const w = await window.familiar.weather()
    document.getElementById('temp').textContent = `${Math.round(w.current.temperature_2m)}°`
    document.getElementById('wdesc').textContent =
      `${WMO[w.current.weather_code] ?? '—'}, ветер ${Math.round(w.current.wind_speed_10m)} км/ч`
    document.getElementById('wrange').textContent =
      `макс. ${Math.round(w.daily.temperature_2m_max[0])}°, мин. ${Math.round(w.daily.temperature_2m_min[0])}°`
  } catch {
    document.getElementById('temp').textContent = '—'
    document.getElementById('wdesc').textContent = 'Нет связи с сервером погоды'
  }
}

// ---------- Батарея (на ПК без батареи карточка скрыта) ----------

async function initBattery() {
  if (!navigator.getBattery) return
  const b = await navigator.getBattery()
  const card = document.getElementById('battery')
  const update = () => {
    // На настольном ПК браузер отдаёт «100%, заряжается» — такую карточку не показываем
    card.hidden = b.charging && b.level === 1 && b.chargingTime === 0
    const pct = Math.round(b.level * 100)
    document.getElementById('bpct').textContent = `${pct}%${b.charging ? ' · заряжается' : ''}`
    card.querySelector('.fill').style.width = pct + '%'
  }
  update()
  b.addEventListener('levelchange', update)
  b.addEventListener('chargingchange', update)
}

// ---------- Напоминания (сохраняются в config.json) ----------

let reminders = []
const ul = document.getElementById('reminders')

function renderReminders() {
  ul.replaceChildren(
    ...reminders.map((r, i) => {
      const li = document.createElement('li')
      li.className = r.done ? 'done' : ''
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = r.done
      cb.addEventListener('change', () => {
        r.done = cb.checked
        save()
      })
      const text = document.createElement('span')
      text.textContent = r.text
      const del = document.createElement('button')
      del.textContent = '✕'
      del.title = 'Удалить'
      del.addEventListener('click', () => {
        reminders.splice(i, 1)
        save()
      })
      li.append(cb, text, del)
      return li
    })
  )
}

function save() {
  renderReminders()
  window.familiar.setReminders(reminders)
}

document.getElementById('newReminder').addEventListener('keydown', (e) => {
  const text = e.target.value.trim()
  if (e.key !== 'Enter' || !text) return
  reminders.push({ text, done: false })
  e.target.value = ''
  save()
})

// ---------- Старт ----------

window.familiar.getConfig().then((config) => {
  reminders = config.reminders ?? []
  renderReminders()
  loadWeather(config)
  setInterval(() => window.familiar.getConfig().then(loadWeather), 15 * 60 * 1000)
})
initBattery()
