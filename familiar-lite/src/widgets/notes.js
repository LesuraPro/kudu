// Заметки: просто текст, сохраняется сам через полсекунды после последней буквы.
// Строки «- [ ] дело» — это список дел: Ctrl+Enter на строке отмечает её «- [x]»
Widget.define('notes', (card) => {
  const head = Widget.el('div', 'head')
  const label = Widget.el('div', 'label', 'Заметки')
  const info = Widget.el('div', 'info')
  head.append(label, info)
  const area = Widget.el('textarea')
  area.spellcheck = false
  area.placeholder = 'Пиши что угодно…\n- [ ] дело — Ctrl+Enter отмечает'
  card.append(head, area)

  let saveTimer
  const updateInfo = (state) => {
    const words = area.value.trim() ? area.value.trim().split(/\s+/).length : 0
    info.textContent = state ?? `${words} сл.`
  }
  area.addEventListener('input', () => {
    updateInfo('…')
    clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      await window.familiar.setWidgetData('notes', { text: area.value })
      updateInfo()
    }, 500)
  })

  // Ctrl+Enter: «- [ ]» ↔ «- [x]» в строке с курсором
  area.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey && e.key === 'Enter')) return
    e.preventDefault()
    const v = area.value
    const start = v.lastIndexOf('\n', area.selectionStart - 1) + 1
    const end = v.indexOf('\n', area.selectionStart)
    const line = v.slice(start, end < 0 ? v.length : end)
    const next = /^\s*- \[ \]/.test(line) ? line.replace('- [ ]', '- [x]') : /^\s*- \[x\]/i.test(line) ? line.replace(/- \[x\]/i, '- [ ]') : `- [ ] ${line}`
    const pos = area.selectionStart + (next.length - line.length)
    area.value = v.slice(0, start) + next + v.slice(start + line.length)
    area.selectionStart = area.selectionEnd = pos
    area.dispatchEvent(new Event('input'))
  })

  window.familiar.widgetData('notes').then((d) => {
    area.value = d?.text ?? ''
    updateInfo()
  })
})
