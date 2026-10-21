// Погода через Open-Meteo: температура точечным шрифтом
Widget.define('weather', (card) => {
  const WMO = {
    0: 'Ясно', 1: 'Преимущественно ясно', 2: 'Переменная облачность', 3: 'Пасмурно',
    45: 'Туман', 48: 'Изморозь', 51: 'Лёгкая морось', 53: 'Морось', 55: 'Сильная морось',
    61: 'Небольшой дождь', 63: 'Дождь', 65: 'Ливень', 66: 'Ледяной дождь', 67: 'Ледяной дождь',
    71: 'Небольшой снег', 73: 'Снег', 75: 'Сильный снег', 77: 'Снежная крупа',
    80: 'Ливневый дождь', 81: 'Ливневый дождь', 82: 'Сильный ливень',
    85: 'Снегопад', 86: 'Сильный снегопад', 95: 'Гроза', 96: 'Гроза с градом', 99: 'Гроза с градом'
  }

  const label = Widget.el('div', 'label', 'Погода')
  const canvas = Widget.el('canvas')
  const desc = Widget.el('div', 'desc', 'Загрузка…')
  card.append(label, canvas, desc)

  let temp = '--°'

  async function load() {
    const config = await window.familiar.getConfig()
    label.textContent = config.weather.city
    try {
      const w = await window.familiar.weather()
      temp = `${Math.round(w.current.temperature_2m)}°`
      desc.textContent =
        `${WMO[w.current.weather_code] ?? '—'} · ветер ${Math.round(w.current.wind_speed_10m)} км/ч\n` +
        `макс. ${Math.round(w.daily.temperature_2m_max[0])}° · мин. ${Math.round(w.daily.temperature_2m_min[0])}°`
      desc.style.whiteSpace = 'pre-line'
    } catch {
      temp = '--°'
      desc.textContent = 'Нет связи с сервером погоды'
    }
  }
  load()
  setInterval(load, 15 * 60 * 1000)
  // Город сменили в настройках — сразу обновляем (в подписи всегда текущий город)
  window.familiar.onConfigChanged((c) => c.weather.city !== label.textContent && load())

  // В мороз температура мигает красным
  Widget.loop((t) => {
    const { ctx, w, h } = Dot.fit(canvas)
    ctx.clearRect(0, 0, w, h)
    const pitch = Math.floor(h / 7)
    const freezing = temp.startsWith('-') && temp !== '--°'
    Dot.draw(ctx, temp, 0, 0, {
      pitch,
      on: freezing && Math.floor(t * 2) % 2 ? Dot.css('--accent') : Dot.css('--text'),
      off: Dot.css('--dot-off')
    })
  })
})
