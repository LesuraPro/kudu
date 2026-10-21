// Общая оболочка виджета: по ?type=... подгружаем нужный файл из widgets/.
// Каждый файл регистрирует себя через Widget.define(name, mount).
;(() => {
  const type = new URLSearchParams(location.search).get('type')
  const card = document.getElementById('card')
  card.classList.add(`w-${type}`)

  window.Widget = {
    define(name, mount) {
      if (name === type) mount(card)
    },
    // Цикл анимации, который ставится на паузу, когда окно скрыто
    loop(fn) {
      let last = performance.now()
      const tick = (now) => {
        const dt = Math.min(0.1, (now - last) / 1000)
        last = now
        if (!document.hidden) fn(now / 1000, dt)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    el(tag, className, text) {
      const e = document.createElement(tag)
      if (className) e.className = className
      if (text != null) e.textContent = text
      return e
    }
  }

  // ПКМ по любому виджету — то же меню, что и у дока
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    window.familiar.dockMenu(-1)
  })

  const script = document.createElement('script')
  script.src = `widgets/${type}.js`
  document.body.appendChild(script)
})()
