// Погода через Open-Meteo: температура и иконка погоды точками
Widget.define('weather', (card) => {
  const WMO = {
    0: 'Ясно', 1: 'Преимущественно ясно', 2: 'Переменная облачность', 3: 'Пасмурно',
    45: 'Туман', 48: 'Изморозь', 51: 'Лёгкая морось', 53: 'Морось', 55: 'Сильная морось',
    61: 'Небольшой дождь', 63: 'Дождь', 65: 'Ливень', 66: 'Ледяной дождь', 67: 'Ледяной дождь',
    71: 'Небольшой снег', 73: 'Снег', 75: 'Сильный снег', 77: 'Снежная крупа',
    80: 'Ливневый дождь', 81: 'Ливневый дождь', 82: 'Сильный ливень',
    85: 'Снегопад', 86: 'Сильный снегопад', 95: 'Гроза', 96: 'Гроза с градом', 99: 'Гроза с градом'
  }

  // Иконки 9×9: '#' — белая точка, 'o' — красная, '.' — погасшая.
  // Капли и снежинки (строки ниже облака) по кадрам сдвигаются — «идёт дождь»
  const CLOUD = ['.........', '...###...', '..#####..', '.#######.', '#########', '.#######.']
  const ICONS = {
    sun: ['....#....', '.#.....#.', '...###...', '..#ooo#..', '#.#ooo#.#', '..#ooo#..', '...###...', '.#.....#.', '....#....'],
    partly: ['.o.......', 'ooo......', '.o.###...', '..#####..', '.#######.', '#########', '.#######.', '.........', '.........'],
    cloud: [...CLOUD, '.........', '.........', '.........'],
    fog: ['.........', '#######..', '.........', '..#######', '.........', '#######..', '.........', '..#######', '.........'],
    rain: [...CLOUD, '.o..o..o.', '..o..o..o', '.o..o..o.'],
    snow: [...CLOUD, '#.#.#.#.#', '.#.#.#.#.', '#.#.#.#.#'],
    storm: [...CLOUD, '....o....', '...o.....', '....o....']
  }
  const iconFor = (code) =>
    code <= 1 ? 'sun' : code === 2 ? 'partly' : code === 3 ? 'cloud' : code <= 48 ? 'fog' : code >= 95 ? 'storm' : (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'snow' : 'rain'

  const label = Widget.el('div', 'label', 'Погода')
  const canvas = Widget.el('canvas')
  const desc = Widget.el('div', 'desc', 'Загрузка…')
  card.append(label, canvas, desc)

  let temp = '--°'
  let icon = null

  async function load() {
    const config = await window.familiar.getConfig()
    label.textContent = config.weather.city
    try {
      const w = await window.familiar.weather()
      temp = `${Math.round(w.current.temperature_2m)}°`
      icon = iconFor(w.current.weather_code)
      desc.textContent =
        `${WMO[w.current.weather_code] ?? '—'} · ветер ${Math.round(w.current.wind_speed_10m)} км/ч\n` +
        `макс. ${Math.round(w.daily.temperature_2m_max[0])}° · мин. ${Math.round(w.daily.temperature_2m_min[0])}°`
      desc.style.whiteSpace = 'pre-line'
    } catch {
      temp = '--°'
      icon = null
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
    const on = Dot.css('--text')
    const accent = Dot.css('--accent')
    Dot.draw(ctx, temp, 0, 0, { pitch, on: freezing && Math.floor(t * 2) % 2 ? accent : on, off: Dot.css('--dot-off') })

    // Иконка справа
    if (!icon) return
    const rows = ICONS[icon]
    const p = h / 9
    const ox = w - 9 * p
    const shift = Math.floor(t * 2) % 3 // капли/снег опускаются на строку каждые полсекунды
    const dots = Dot.batch(ctx)
    rows.forEach((row, y) => {
      const falling = y >= CLOUD.length && (icon === 'rain' || icon === 'snow')
      const src = falling ? rows[CLOUD.length + ((y - CLOUD.length - shift + 3) % 3)] : row
      for (let x = 0; x < 9; x++) {
        const c = src[x]
        if (c !== '.') dots.dot(ox + x * p + p / 2, y * p + p / 2, p * 0.38, c === 'o' ? accent : on)
      }
    })
    dots.flush()
  }, { fps: 2 })
})
