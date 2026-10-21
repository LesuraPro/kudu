// Уровень громкости и спектр для визуализаций.
// На Windows слушаем звук системы (loopback), иначе — имитация в такт музыке.
;(() => {
  let analyser = null
  let bins = null
  const spectrum = new Float32Array(32)
  let level = 0
  let source = 'sim'

  async function start() {
    try {
      // Видео браузер требует обязательно — берём минимум и не используем
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { width: 1, height: 1, frameRate: 1 }
      })
      if (!stream.getAudioTracks().length) throw new Error('нет звуковой дорожки')
      const ctx = new AudioContext()
      analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.75
      ctx.createMediaStreamSource(stream).connect(analyser)
      bins = new Uint8Array(analyser.frequencyBinCount)
      source = 'loopback'
    } catch {
      analyser = null
      source = 'sim'
    }
  }

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
