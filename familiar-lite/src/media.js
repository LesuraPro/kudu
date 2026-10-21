// Состояние плеера для окон: последнее, что прислал главный процесс,
// плюс плавная позиция трека между обновлениями.
;(() => {
  let state = { status: 'none' }
  const listeners = []

  function update(next) {
    state = { ...next, localAt: performance.now() }
    for (const cb of listeners) cb(state)
  }

  window.Media = {
    get: () => state,
    playing: () => state.status === 'playing',
    hasTrack: () => state.status !== 'none' && !!state.title,
    // Позиция в секундах «прямо сейчас»
    position() {
      if (!this.hasTrack()) return 0
      const extra = this.playing() ? (performance.now() - state.localAt) / 1000 : 0
      const pos = (state.position ?? 0) + extra
      return state.duration > 0 ? Math.min(pos, state.duration) : pos
    },
    progress() {
      return state.duration > 0 ? this.position() / state.duration : 0
    },
    onChange(cb) {
      listeners.push(cb)
      cb(state)
    },
    cmd: (c) => window.familiar.mediaCmd(c),
    // «1:05»
    fmt(sec) {
      sec = Math.max(0, Math.floor(sec || 0))
      return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
    },
    // Из «Spotify.exe» или «SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify» делаем «Spotify»
    appName() {
      const id = state.app || ''
      const tail = id.split('!').pop().replace(/\.exe$/i, '')
      if (/chrome/i.test(id)) return 'Chrome'
      if (/msedge/i.test(id)) return 'Edge'
      if (/firefox/i.test(id)) return 'Firefox'
      if (/yandex/i.test(id)) return 'Яндекс'
      return tail || 'Музыка'
    }
  }

  window.familiar.getMedia().then(update)
  window.familiar.onMedia(update)
})()
