// Напоминания: хранятся в config.json, видны и в острове
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
        li.append(Widget.el('i', 'box'), Widget.el('span', '', r.text), del)
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

  window.familiar.getConfig().then((c) => {
    reminders = c.reminders ?? []
    render()
  })
})
