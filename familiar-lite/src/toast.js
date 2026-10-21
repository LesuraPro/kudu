// Уведомление конвертера: «готово / что получилось» и кнопки Открыть, В папке, Отменить
const $ = (id) => document.getElementById(id)
const toast = $('toast')
let hideTimer = null
let hovered = false
let busy = false

const STATES = { busy: 'Преобразую…', done: 'Готово', info: 'Ничего не поменялось', error: 'Не получилось', undone: 'Отменено' }

window.familiar.onToast((t) => {
  clearTimeout(hideTimer)
  busy = t.state === 'busy'
  $('state').textContent = STATES[t.state] ?? 'Конвертер'
  $('title').textContent = t.title ?? ''
  $('note').textContent = t.note ?? ''
  $('note').title = t.note ?? ''
  toast.classList.toggle('error', t.state === 'error')
  $('actions').hidden = t.state !== 'done'
  $('thumb').style.backgroundImage = t.thumb ? `url("${t.thumb}")` : ''
  $('spinner').hidden = !!t.thumb
  toast.classList.add('show')
  if (!busy) scheduleHide(t.state === 'error' ? 10000 : 7000)
})

function scheduleHide(ms) {
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => {
    if (hovered) return scheduleHide(1500)
    toast.classList.remove('show')
    setTimeout(() => window.familiar.toastAction('hide'), 250)
  }, ms)
}

toast.addEventListener('mouseenter', () => (hovered = true))
toast.addEventListener('mouseleave', () => (hovered = false))
$('actions').addEventListener('click', (e) => {
  const act = e.target.dataset.act
  if (!act) return
  window.familiar.toastAction(act)
  if (act !== 'undo') scheduleHide(300)
})

// Точечный индикатор: по кругу бегает красная точка, пока идёт работа
const spinner = $('spinner')
let frame = 0
setInterval(() => {
  if (spinner.hidden || !toast.classList.contains('show')) return
  const { ctx, w, h } = Dot.fit(spinner)
  ctx.clearRect(0, 0, w, h)
  const dots = Dot.batch(ctx)
  const n = 8
  frame++
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    const head = busy ? frame % n : -1
    dots.dot(w / 2 + Math.cos(a) * 11, h / 2 + Math.sin(a) * 11, i === head ? 3 : 2, i === head ? Dot.css('--accent') : Dot.css('--text'), i === head ? 1 : busy ? 0.3 : 0.8)
  }
  dots.flush()
}, 90)
