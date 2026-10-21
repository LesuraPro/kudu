// Уровень громкости и спектр для визуализаций.
// На Windows слушаем звук системы (loopback), иначе — имитация в такт музыке.
;(() => {
  let analyser = null
  let bins = null
  const spectrum = new Float32Array(32)
  let level = 0
  let source = 'sim'

  let ctx = null

  // keepVideo — запасной путь: если без видео звук пропадает, захватываем как раньше
  async function start(keepVideo = false) {
    try {
      // Без видео браузер захват не начнёт — просим минимум
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { width: 1, height: 1, frameRate: 1 }
      })
      const audio = stream.getAudioTracks()[0]
      if (!audio) throw new Error('нет звуковой дорожки')
      // Видео нам не нужно: останавливаем, чтобы система не захватывала экран впустую
      if (!keepVideo) for (const v of stream.getVideoTracks()) v.stop()
      ctx = new AudioContext()
      analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.75
      ctx.createMediaStreamSource(stream).connect(analyser)
      bins = new Uint8Array(analyser.frequencyBinCount)
      source = 'loopback'
      audio.addEventListener('ended', () => {
        analyser = null
        source = 'sim'
        ctx?.close()
        // Звук оборвался вслед за видео — значит, этой версии Windows видео нужно
        if (!keepVideo) start(true)
      })
    } catch {
      analyser = null
      source = 'sim'
    }
  }

  // В паузе (игра на весь экран, экран заблокирован) анализ звука не нужен
  window.Power?.onChange((mode) => {
    if (!ctx) return
    if (mode === 'paused') ctx.suspend()
    else ctx.resume()
  })

  // Имитация: «бит» ~120 BPM плюс шум, если музыка играет; тихое дыхание, если нет
  function simulate(t) {
    const playing = window.Media?.playing()
    const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2)), 8)
    for (let i = 0; i < spectrum.length; i++) {
      const f = i / spectrum.length
      const wobble = 0.5 + 0.5 * Math.sin(t * (2 + i * 0.37) + i * 1.7)
      const target = playing ? (1 - f) * 0.55 * beat + wobble * 0.35 * (1 - f * 0.6) : 0.04 + 0.03 * Math.sin(t + i)
      spectrum[i] += (target - spectrum[i]) * 0.25
    }
  }

  function update(t) {
    if (analyser) {
      analyser.getByteFrequencyData(bins)
      // 128 бинов → 32 полосы, низы подробнее (логарифмически)
      for (let i = 0; i < spectrum.length; i++) {
        const a = Math.floor(Math.pow(i / spectrum.length, 1.6) * bins.length)
        const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / spectrum.length, 1.6) * bins.length))
        let sum = 0
        for (let j = a; j < b; j++) sum += bins[j]
        spectrum[i] = sum / (b - a) / 255
      }
    } else {
      simulate(t)
    }
    let s = 0
    for (let i = 0; i < 6; i++) s += spectrum[i]
    level += (s / 6 - level) * 0.35
  }

  window.Sound = {
    start,
    update,
    spectrum,
    level: () => level,
    source: () => source
  }
})()
