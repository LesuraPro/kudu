// Режим питания из главного процесса (см. «Режим питания» в main.js):
// normal — как обычно, saver — вдвое меньше кадров, paused — анимации стоят.
;(() => {
  let mode = 'normal'
  const listeners = []

  function set(next) {
    mode = next
    // CSS-анимации (эквалайзер, бегущие строки) тоже ставим на паузу — см. theme.css
    document.documentElement.classList.toggle('power-paused', mode === 'paused')
    for (const cb of listeners) cb(mode)
  }

  window.Power = {
    mode: () => mode,
    // Во сколько раз уменьшить частоту кадров: 0 — не рисовать совсем
    factor: () => (mode === 'paused' ? 0 : mode === 'saver' ? 0.5 : 1),
    onChange: (cb) => listeners.push(cb)
  }

  window.familiar.getPower().then(set)
  window.familiar.onPower(set)
})()
