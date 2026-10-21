// Напоминания: хранятся в config.json, видны в острове и календаре
Widget.define('reminders', (card) => {
  const label = Widget.el('div', 'label', 'Напоминания')
  const ul = Widget.el('ul')
  const input = Widget.el('input')
  input.placeholder = 'Новое + Enter'
  card.append(label, ul, input)

  let reminders = []

  function render() {
    ul.replaceChildren(
      ...reminders.map((r, i) => {
        const li = Widget.el('li', r.done ? 'done' : '')
        const del = Widget.el('button', '', '✕')
        del.title = 'Удалить'
        del.addEventListener('click', (e) => {
          e.stopPropagation()
          reminders.splice(i, 1)
          save()
        })
        li.append(Widget.el('i', 'box'), Widget.el('span', '', r.text))
        // Напоминание из календаря — показываем дату
        if (r.date) {
          const [y, m, d] = r.date.split('-').map(Number)
          li.append(Widget.el('small', '', new Date(y, m - 1, d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })))
        }
        li.append(del)
        li.addEventListener('click', () => {
          r.done = !r.done
          save()
        })
        return li
      })
    )
  }

  function save() {
    render()
    window.familiar.setReminders(reminders)
  }

  input.addEventListener('keydown', (e) => {
    const text = input.value.trim()
    if (e.key !== 'Enter' || !text) return
    reminders.push({ text, done: false })
    input.value = ''
    save()
  })

  // Календарь тоже меняет напоминания — подхватываем
  const load = (c) => {
    reminders = c.reminders ?? []
    render()
  }
  window.familiar.getConfig().then(load)
  window.familiar.onConfigChanged(load)
})
