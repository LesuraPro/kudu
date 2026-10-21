// Общая оболочка виджета: по ?type=... подгружаем нужный файл из widgets/.
// Каждый файл регистрирует себя через Widget.define(name, mount).
;(() => {
  const params = new URLSearchParams(location.search)
  const type = params.get('type')
  const card = document.getElementById('card')
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  card.classList.add(`w-${type.replace(/[^\w-]+/g, '-')}`)

  window.Widget = {
    define(name, mount) {
      if (name === type) mount(card)
    },
    // Цикл анимации. fps — сколько кадров в секунду реально нужно виджету:
    // часам хватает 20, терминалу 20, визуализатору 40. Лишние кадры пропускаем.
    // Окно скрыто — не рисуем вовсе. «Уменьшить движение» в Windows — не больше 8 кадров
    loop(fn, { fps = 30 } = {}) {
      Widget.schedule(fn, () => (reducedMotion.matches ? Math.min(fps, 8) : fps))
    },
    // Важно: между кадрами ждём таймером, а не requestAnimationFrame. Пока запрошен rAF,
    // Chromium 60 раз в секунду гоняет полный цикл кадра, даже если рисовать нечего —
    // так «4 кадра в секунду» стоили бы как 60
    schedule(fn, getFps) {
      let last = performance.now()
      const tick = (now) => {
        const dt = Math.min(0.1, (now - last) / 1000)
        last = now
        if (!document.hidden) fn(now / 1000, dt)
        next()
      }
      const next = () => {
        const wait = 1000 / getFps() - (performance.now() - last)
        if (wait > 8) setTimeout(() => requestAnimationFrame(tick), wait - 4)
        else requestAnimationFrame(tick)
      }
      next()
    },
    // Записать текст, только если он поменялся: запись в DOM на каждом кадре — лишняя работа
    text(node, value) {
      if (node.textContent !== value) node.textContent = value
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
