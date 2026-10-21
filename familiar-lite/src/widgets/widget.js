// Общая оболочка виджета: по ?type=... подгружаем нужный файл из widgets/.
// Каждый файл регистрирует себя через Widget.define(name, mount).
;(() => {
  const params = new URLSearchParams(location.search)
  const type = params.get('type')
  const card = document.getElementById('card')
  card.classList.add(`w-${type.replace(/[^\w-]+/g, '-')}`)

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

  // Свой виджет грузится из папки пользователя, встроенный — из widgets/
  const script = document.createElement('script')
  script.src = params.get('custom') || `widgets/${type}.js`
  script.onerror = () => (card.textContent = `Не удалось загрузить виджет «${type}»`)
  document.body.appendChild(script)
})()
