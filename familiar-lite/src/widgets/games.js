// Игры: обложки установленных игр из Steam и Epic, клик — запуск.
// Без обложки рисуем название точечным шрифтом.
Widget.define('games', (card) => {
  const label = Widget.el('div', 'label', 'Игры')
  const grid = Widget.el('div', 'grid')
  card.append(label, grid)

  function tile(game) {
    const el = Widget.el('button', 'tile')
    el.title = `${game.name} · ${game.store}`
    const name = Widget.el('span', 'name', game.name)
    el.append(name)
    el.addEventListener('click', () => window.familiar.launch(game))

    window.familiar.gameCover(game.id).then((cover) => {
      if (cover) {
        el.style.backgroundImage = `url("${cover}")`
        el.classList.add('has-cover')
        return
      }
      // Заглушка: первые буквы точками
      const c = Widget.el('canvas')
      el.prepend(c)
      requestAnimationFrame(() => {
        const { ctx, w, h } = Dot.fit(c)
        const text = game.name.replace(/[^\p{L}\p{N} ]/gu, '').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('')
        const pitch = Math.floor(Math.min(w / (Dot.width(text) + 2), h / 9))
        Dot.draw(ctx, text, (w - Dot.width(text) * pitch) / 2, (h - 7 * pitch) / 2, {
          pitch,
          on: Dot.css('--text'),
          off: Dot.css('--dot-off')
        })
      })
    })
    return el
  }

  window.familiar.listGames().then((games) => {
    label.textContent = `Игры · ${games.length}`
    if (!games.length) {
      grid.append(Widget.el('div', 'empty', 'Игры из Steam и Epic Games не найдены'))
      return
    }
    grid.append(...games.map(tile))
  })
})
