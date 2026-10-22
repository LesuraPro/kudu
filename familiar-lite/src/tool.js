// Окно инструмента конвертера — как окна инструментов у оригинала DragShift.
// Всё рисуется здесь же на canvas: превью — уменьшенная копия (быстро), а при сохранении
// то же самое повторяется на картинке в полном размере. Готовые байты уходят в главный
// процесс, он кладёт файл рядом с оригиналом и показывает уведомление с «Отменить».
const $ = (id) => document.getElementById(id)
const params = new URLSearchParams(location.search)
const TOOL = params.get('tool')
const FILES = JSON.parse(params.get('files') || '[]')

const stage = $('stage')
const view = $('view')
const ctx = view.getContext('2d')
const controls = $('controls')
const statusEl = $('status')
const saveBtn = $('save')
const resetBtn = $('reset')

let file = null // { path, name, ext, size, bytes }
let img = null // картинка в полном размере (поворот из EXIF уже учтён)
let preview = null // уменьшенная копия для экрана
let box = { x: 0, y: 0, w: 1, h: 1, k: 1 } // где картинка на экране и её масштаб

// ---------- Мелочи ----------

const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}
const section = (title) => controls.appendChild(el('h2', null, title))
const hint = (text) => controls.appendChild(el('p', 'hint', text))
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

const fmtSize = (b) => (b < 1024 ? `${b} Б` : b < 1024 ** 2 ? `${Math.round(b / 1024)} КБ` : `${(b / 1024 ** 2).toFixed(1).replace('.', ',')} МБ`)

// Ряд «таблеток»: выбор одного из нескольких
function chips(items, active, onPick) {
  const row = el('div', 'chips')
  const buttons = items.map(([value, label]) => {
    const b = el('button', 'chip' + (value === active ? ' active' : ''))
    b.innerHTML = label
    b.addEventListener('click', () => {
      buttons.forEach((x) => x.classList.toggle('active', x === b))
      onPick(value)
    })
    row.appendChild(b)
    return b
  })
  row.select = (value) => buttons.forEach((b, i) => b.classList.toggle('active', items[i][0] === value))
  controls.appendChild(row)
  return row
}

// Ползунок с подписью и значением справа
function slider(label, min, max, value, fmt, onInput, step = 1) {
  const wrap = el('label', 'slider')
  const name = el('span', null, label)
  const out = el('output')
  const input = Object.assign(el('input'), { type: 'range', min, max, step, value })
  const paint = () => {
    out.textContent = fmt(+input.value)
    input.style.setProperty('--fill', `${((input.value - min) / (max - min)) * 100}%`)
  }
  input.addEventListener('input', () => {
    paint()
    onInput(+input.value)
  })
  wrap.append(name, out, input)
  controls.appendChild(wrap)
  paint()
  wrap.set = (v) => {
    input.value = v
    paint()
  }
  return wrap
}

const ICON = {
  rotL: '<svg viewBox="0 0 24 24"><path d="M4 4v6h6"/><path d="M4.5 10A8 8 0 1 1 6 17"/></svg>',
  rotR: '<svg viewBox="0 0 24 24"><path d="M20 4v6h-6"/><path d="M19.5 10A8 8 0 1 0 18 17"/></svg>',
  flipH: '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M8 7 3 12l5 5z"/><path d="m16 7 5 5-5 5z"/></svg>',
  flipV: '<svg viewBox="0 0 24 24"><path d="M3 12h18"/><path d="M7 8l5-5 5 5z"/><path d="m7 16 5 5 5-5z"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>'
}

// ---------- Картинка ----------

const decode = (bytes) => createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' })

async function loadImage(bytes) {
  const bitmap = await decode(bytes)
  // Превью — не больше 1600 точек по длинной стороне: ползунки двигаются без задержек
  const k = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const small = k < 1 ? await createImageBitmap(bitmap, { resizeWidth: Math.round(bitmap.width * k), resizeHeight: Math.round(bitmap.height * k), resizeQuality: 'high' }) : bitmap
  return { bitmap, small }
}

// В каком формате сохранять: JPG, PNG и WebP — как было, остальное — в PNG
const outExt = (ext) => (ext === 'jpeg' ? 'jpg' : ['jpg', 'png', 'webp'].includes(ext) ? ext : 'png')
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

async function encode(canvas, ext, quality = 0.92) {
  let src = canvas
  if (ext === 'jpg') {
    // JPG без прозрачности — подкладываем белый
    src = new OffscreenCanvas(canvas.width, canvas.height)
    const c = src.getContext('2d')
    c.fillStyle = '#fff'
    c.fillRect(0, 0, src.width, src.height)
    c.drawImage(canvas, 0, 0)
  }
  const blob = await src.convertToBlob({ type: MIME[ext], quality })
  return new Uint8Array(await blob.arrayBuffer())
}

function newCanvas(w, h) {
  return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)))
}

// Нарисовать картинку с поворотом на rot (0/90/180/270) и отражениями так, чтобы она
// заняла прямоугольник от (0,0) — в координатах уже повёрнутой картинки
function drawTurned(c, src, W, H, { rot = 0, flipH = false, flipV = false } = {}) {
  c.save()
  if (rot === 90) c.translate(H, 0)
  else if (rot === 180) c.translate(W, H)
  else if (rot === 270) c.translate(0, W)
  c.rotate((rot * Math.PI) / 180)
  if (flipH) c.translate(W, 0), c.scale(-1, 1)
  if (flipV) c.translate(0, H), c.scale(1, -1)
  c.drawImage(src, 0, 0, W, H)
  c.restore()
}
const turnedSize = (rot) => (rot % 180 ? [img.height, img.width] : [img.width, img.height])

// ---------- Сцена ----------

let dpr = 1
function resizeView() {
  dpr = window.devicePixelRatio || 1
  view.width = Math.round(stage.clientWidth * dpr)
  view.height = Math.round(stage.clientHeight * dpr)
  redraw()
}

// Вписать W×H в сцену с полями
function fitBox(W, H, margin = 36) {
  const sw = stage.clientWidth - margin * 2
  const sh = stage.clientHeight - margin * 2 - 30 // снизу — строка состояния
  const k = Math.min(sw / W, sh / H, 4)
  box = { k, w: W * k, h: H * k, x: (stage.clientWidth - W * k) / 2, y: (stage.clientHeight - 30 - H * k) / 2 }
  return box
}

let frame = 0
function redraw() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, view.width, view.height)
    tool.render?.()
  })
}

// Координаты мыши → координаты картинки
const toImage = (e) => {
  const r = view.getBoundingClientRect()
  return { x: (e.clientX - r.left - box.x) / box.k, y: (e.clientY - r.top - box.y) / box.k, sx: e.clientX - r.left, sy: e.clientY - r.top }
}

let dragging = false
view.addEventListener('pointerdown', (e) => {
  if (!tool.down) return
  view.setPointerCapture(e.pointerId)
  dragging = true
  tool.down(toImage(e), e)
  redraw()
})
view.addEventListener('pointermove', (e) => {
  if (dragging) tool.move?.(toImage(e), e)
  else tool.hover?.(toImage(e), e)
  redraw()
})
view.addEventListener('pointerup', (e) => {
  if (!dragging) return
  dragging = false
  tool.up?.(toImage(e), e)
  redraw()
})
view.addEventListener('dblclick', (e) => tool.dbl?.(toImage(e), e) ?? redraw())

const setStatus = (html) => (statusEl.innerHTML = html)

// Тёмная вуаль вокруг выделения и рамка с «третями»
function drawSelection(sel, { grid = true, handles = true } = {}) {
  const x = box.x + sel.x * box.k
  const y = box.y + sel.y * box.k
  const w = sel.w * box.k
  const h = sel.h * box.k
  ctx.save()
  ctx.fillStyle = 'rgba(4, 8, 16, 0.62)'
  ctx.beginPath()
  ctx.rect(box.x, box.y, box.w, box.h)
  ctx.rect(x, y, w, h)
  ctx.fill('evenodd')
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e0244e'
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  if (grid) {
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.beginPath()
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(x + (w * i) / 3, y)
      ctx.lineTo(x + (w * i) / 3, y + h)
      ctx.moveTo(x, y + (h * i) / 3)
      ctx.lineTo(x + w, y + (h * i) / 3)
    }
    ctx.stroke()
  }
  if (handles) {
    ctx.fillStyle = accent
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    for (const [hx, hy] of handlePoints(sel)) {
      ctx.beginPath()
      ctx.arc(box.x + hx * box.k, box.y + hy * box.k, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }
  ctx.restore()
}

const handlePoints = (s) => [
  [s.x, s.y, 'nw'], [s.x + s.w / 2, s.y, 'n'], [s.x + s.w, s.y, 'ne'], [s.x + s.w, s.y + s.h / 2, 'e'],
  [s.x + s.w, s.y + s.h, 'se'], [s.x + s.w / 2, s.y + s.h, 's'], [s.x, s.y + s.h, 'sw'], [s.x, s.y + s.h / 2, 'w']
]

// ---------- Инструменты ----------

const TOOLS = {}

// ===== Обрезать =====
TOOLS.crop = () => {
  let rot = 0
  let ratio = null
  let sel = null
  let mode = null
  let start = null
  const [W0, H0] = [img.width, img.height]
  const dims = () => turnedSize(rot)
  const RATIOS = [[null, 'Свободно'], ['orig', 'Исходные'], [1, '1:1'], [4 / 3, '4:3'], [3 / 2, '3:2'], [16 / 9, '16:9'], [9 / 16, '9:16'], [4 / 5, '4:5']]
  const realRatio = () => (ratio === 'orig' ? W0 / H0 : ratio)

  // Самая большая рамка нужной пропорции по центру
  function fullSel() {
    const [W, H] = dims()
    const r = realRatio()
    if (!r) return { x: 0, y: 0, w: W, h: H }
    let w = W
    let h = w / r
    if (h > H) (h = H), (w = h * r)
    return { x: (W - w) / 2, y: (H - h) / 2, w, h }
  }
  sel = fullSel()

  section('Пропорции')
  chips(RATIOS, null, (r) => {
    ratio = r
    sel = fullSel()
    syncInputs()
    redraw()
  })
  section('Поворот')
  chips([['l', ICON.rotL + ' 90°'], ['r', ICON.rotR + ' 90°']], '', (d) => {
    rot = (rot + (d === 'r' ? 90 : 270)) % 360
    sel = fullSel()
    syncInputs()
    redraw()
  }).select(null)
  section('Размер рамки')
  const row = el('div', 'field')
  const wIn = Object.assign(el('input'), { type: 'number', min: 1 })
  const hIn = Object.assign(el('input'), { type: 'number', min: 1 })
  row.append(wIn, el('span', 'unit', '×'), hIn, el('span', 'unit', 'px'))
  controls.appendChild(row)
  hint('Тяни за края и углы, двигай рамку целиком. Двойной щелчок — вся картинка.')
  const syncInputs = () => {
    wIn.value = Math.round(sel.w)
    hIn.value = Math.round(sel.h)
  }
  const fromInputs = (changed) => {
    const [W, H] = dims()
    const r = realRatio()
    let w = clamp(+wIn.value || 1, 1, W)
    let h = clamp(+hIn.value || 1, 1, H)
    if (r) changed === 'w' ? (h = w / r) : (w = h * r)
    if (w > W) (w = W), r && (h = w / r)
    if (h > H) (h = H), r && (w = h * r)
    const cx = sel.x + sel.w / 2
    const cy = sel.y + sel.h / 2
    sel = { w, h, x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h) }
    syncInputs()
    redraw()
  }
  wIn.addEventListener('change', () => fromInputs('w'))
  hIn.addEventListener('change', () => fromInputs('h'))
  syncInputs()

  // Прямоугольник от закреплённой точки до курсора, с пропорцией и в пределах картинки
  function fromAnchor(ax, ay, px, py) {
    const [W, H] = dims()
    const r = realRatio()
    px = clamp(px, 0, W)
    py = clamp(py, 0, H)
    let w = Math.abs(px - ax)
    let h = Math.abs(py - ay)
    if (r) {
      if (w / h > r) w = h * r
      else h = w / r
      // Не вылезти за край с той стороны, куда тянем
      const maxW = px >= ax ? W - ax : ax
      const maxH = py >= ay ? H - ay : ay
      if (w > maxW) (w = maxW), (h = w / r)
      if (h > maxH) (h = maxH), (w = h * r)
    }
    return { x: px >= ax ? ax : ax - w, y: py >= ay ? ay : ay - h, w, h }
  }

  return {
    suffix: 'обрезано',
    render() {
      const [W, H] = dims()
      fitBox(W, H)
      ctx.save()
      ctx.translate(box.x, box.y)
      ctx.scale(box.k, box.k)
      drawTurned(ctx, preview, W0, H0, { rot })
      ctx.restore()
      drawSelection(sel)
      setStatus(`<b>${Math.round(sel.w)} × ${Math.round(sel.h)}</b> из ${W} × ${H}`)
    },
    hover(p) {
      const near = handlePoints(sel).find(([hx, hy]) => Math.hypot((hx - p.x) * box.k, (hy - p.y) * box.k) < 12)
      const inside = p.x > sel.x && p.x < sel.x + sel.w && p.y > sel.y && p.y < sel.y + sel.h
      const CUR = { n: 'ns', s: 'ns', e: 'ew', w: 'ew', ne: 'nesw', sw: 'nesw', nw: 'nwse', se: 'nwse' }
      view.style.cursor = near ? `${CUR[near[2]]}-resize` : inside ? 'move' : 'crosshair'
    },
    down(p) {
      const near = handlePoints(sel).find(([hx, hy]) => Math.hypot((hx - p.x) * box.k, (hy - p.y) * box.k) < 12)
      start = { p, sel: { ...sel } }
      if (near) mode = near[2]
      else if (p.x > sel.x && p.x < sel.x + sel.w && p.y > sel.y && p.y < sel.y + sel.h) mode = 'move'
      else mode = 'new'
    },
    move(p) {
      const [W, H] = dims()
      const s = start.sel
      if (mode === 'move') {
        sel = { ...s, x: clamp(s.x + p.x - start.p.x, 0, W - s.w), y: clamp(s.y + p.y - start.p.y, 0, H - s.h) }
      } else if (mode === 'new') {
        const n = fromAnchor(clamp(start.p.x, 0, W), clamp(start.p.y, 0, H), p.x, p.y)
        if (n.w > 4 && n.h > 4) sel = n
      } else if (mode.length === 2) {
        // Угол: противоположный угол стоит на месте
        const ax = mode.includes('w') ? s.x + s.w : s.x
        const ay = mode.includes('n') ? s.y + s.h : s.y
        const n = fromAnchor(ax, ay, p.x, p.y)
        if (n.w > 4 && n.h > 4) sel = n
      } else {
        // Сторона: двигаем одну сторону, с пропорцией вторую подгоняем по центру
        const r = realRatio()
        let { x, y, w, h } = s
        if (mode === 'e') w = clamp(p.x, s.x + 5, W) - s.x
        if (mode === 'w') (x = clamp(p.x, 0, s.x + s.w - 5)), (w = s.x + s.w - x)
        if (mode === 's') h = clamp(p.y, s.y + 5, H) - s.y
        if (mode === 'n') (y = clamp(p.y, 0, s.y + s.h - 5)), (h = s.y + s.h - y)
        if (r) {
          if (mode === 'e' || mode === 'w') {
            h = Math.min(w / r, H)
            w = h * r
            if (mode === 'w') x = s.x + s.w - w
            y = clamp(s.y + s.h / 2 - h / 2, 0, H - h)
          } else {
            w = Math.min(h * r, W)
            h = w / r
            if (mode === 'n') y = s.y + s.h - h
            x = clamp(s.x + s.w / 2 - w / 2, 0, W - w)
          }
        }
        sel = { x, y, w, h }
      }
      syncInputs()
    },
    dbl() {
      sel = fullSel()
      syncInputs()
      redraw()
    },
    reset() {
      rot = 0
      sel = fullSel()
      syncInputs()
    },
    export() {
      const out = newCanvas(sel.w, sel.h)
      const c = out.getContext('2d')
      c.translate(-Math.round(sel.x), -Math.round(sel.y))
      drawTurned(c, img, W0, H0, { rot })
      return out
    }
  }
}

// ===== Правка: свет, цвет, поворот =====

// Тепло и резкость — попиксельно; остальное делает фильтр canvas
function pixelPass(canvas, { warmth = 0, sharp = 0 }) {
  if (!warmth && !sharp) return
  const c = canvas.getContext('2d')
  const W = canvas.width
  const H = canvas.height
  const image = c.getImageData(0, 0, W, H)
  const d = image.data
  if (sharp) {
    // Нерезкая маска: к каждой точке добавляем её отличие от соседей
    const src = new Uint8ClampedArray(d)
    const a = sharp
    const row = W * 4
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * row + x * 4
        for (let k = 0; k < 3; k++) {
          const v = src[i + k]
          d[i + k] = v + a * (4 * v - src[i + k - 4] - src[i + k + 4] - src[i + k - row] - src[i + k + row])
        }
      }
  }
  if (warmth) {
    const k = warmth * 25
    for (let i = 0; i < d.length; i += 4) {
      d[i] += k
      d[i + 2] -= k
    }
  }
  c.putImageData(image, 0, 0)
}

TOOLS.edit = () => {
  const DEFAULT = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, sharp: 0, gray: false, rot: 0, flipH: false, flipV: false }
  let s = { ...DEFAULT }
  let compare = false
  let work = null

  // Те же правки — и для превью, и для полного размера
  function apply(src, W, H) {
    const c0 = newCanvas(W, H)
    const c = c0.getContext('2d')
    c.filter = `brightness(${1 + s.brightness / 100}) contrast(${1 + s.contrast / 100}) saturate(${1 + s.saturation / 100})${s.gray ? ' grayscale(1)' : ''}`
    c.drawImage(src, 0, 0, W, H)
    c.filter = 'none'
    pixelPass(c0, { warmth: s.warmth / 100, sharp: s.sharp / 100 })
    return c0
  }
  const refresh = () => {
    work = apply(preview, preview.width, preview.height)
    redraw()
  }

  section('Свет и цвет')
  const sliders = {
    brightness: slider('Яркость', -50, 50, 0, (v) => (v > 0 ? `+${v}` : v), (v) => ((s.brightness = v), refresh())),
    contrast: slider('Контраст', -50, 50, 0, (v) => (v > 0 ? `+${v}` : v), (v) => ((s.contrast = v), refresh())),
    saturation: slider('Насыщенность', -100, 100, 0, (v) => (v > 0 ? `+${v}` : v), (v) => ((s.saturation = v), refresh())),
    warmth: slider('Тепло', -100, 100, 0, (v) => (v > 0 ? `+${v}` : v), (v) => ((s.warmth = v), refresh())),
    sharp: slider('Резкость', 0, 100, 0, (v) => v, (v) => ((s.sharp = v), refresh()))
  }
  const grayRow = chips([['color', 'Цвет'], ['gray', 'Ч/Б'], ['auto', 'Авто']], 'color', (v) => {
    if (v === 'auto') {
      auto()
      grayRow.select(s.gray ? 'gray' : 'color')
      return
    }
    s.gray = v === 'gray'
    refresh()
  })
  section('Поворот и отражение')
  chips([['l', ICON.rotL], ['r', ICON.rotR], ['h', ICON.flipH], ['v', ICON.flipV]], '', (v) => {
    if (v === 'l') s.rot = (s.rot + 270) % 360
    if (v === 'r') s.rot = (s.rot + 90) % 360
    // Отражение после поворота на 90° меняет смысл осей
    if (v === 'h') s.rot % 180 ? (s.flipV = !s.flipV) : (s.flipH = !s.flipH)
    if (v === 'v') s.rot % 180 ? (s.flipH = !s.flipH) : (s.flipV = !s.flipV)
    redraw()
  }).select(null)
  section('Сравнить')
  const cmp = el('button', 'chip', 'Держи, чтобы увидеть «до»')
  cmp.addEventListener('pointerdown', () => ((compare = true), redraw()))
  for (const ev of ['pointerup', 'pointerleave']) cmp.addEventListener(ev, () => ((compare = false), redraw()))
  controls.appendChild(Object.assign(el('div', 'chips'), {})).appendChild(cmp)

  // «Авто» — мягкие правки по гистограмме, как кнопка на телефоне (формулы — как у оригинала)
  function auto() {
    const c = newCanvas(preview.width, preview.height).getContext('2d')
    c.drawImage(preview, 0, 0)
    const d = c.getImageData(0, 0, preview.width, preview.height).data
    let sum = 0
    let sum2 = 0
    let sat = 0
    const n = d.length / 4
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      sum += l
      sum2 += l * l
      const mx = Math.max(d[i], d[i + 1], d[i + 2])
      const mn = Math.min(d[i], d[i + 1], d[i + 2])
      sat += mx ? ((mx - mn) / mx) * 255 : 0
    }
    const mean = sum / n
    const std = Math.sqrt(sum2 / n - mean * mean)
    s.brightness = Math.round((clamp(1 + (118 - mean) / 400, 0.85, 1.25) - 1) * 100)
    s.contrast = Math.round((clamp(1 + (58 - std) / 160, 0.95, 1.3) - 1) * 100)
    s.saturation = Math.round((clamp(1 + (110 - sat / n) / 400, 1, 1.3) - 1) * 100)
    s.sharp = 15
    for (const k of Object.keys(sliders)) sliders[k].set(s[k])
    refresh()
  }

  refresh()
  return {
    suffix: 'правка',
    render() {
      const [W, H] = turnedSize(s.rot)
      fitBox(W, H)
      ctx.save()
      ctx.translate(box.x, box.y)
      ctx.scale(box.k, box.k)
      drawTurned(ctx, compare ? preview : work, img.width, img.height, s)
      ctx.restore()
      setStatus(compare ? '<b>до</b>' : `<b>${W} × ${H}</b>`)
    },
    reset() {
      s = { ...DEFAULT }
      for (const k of Object.keys(sliders)) sliders[k].set(0)
      grayRow.select('color')
      refresh()
    },
    export() {
      const done = apply(img, img.width, img.height)
      const [W, H] = turnedSize(s.rot)
      const out = newCanvas(W, H)
      drawTurned(out.getContext('2d'), done, img.width, img.height, s)
      return out
    }
  }
}

// ===== Пометки: стрелки, рамки, текст, шаги =====

function drawShape(c, s) {
  c.save()
  c.strokeStyle = s.color
  c.fillStyle = s.color
  c.lineWidth = s.width
  c.lineCap = 'round'
  c.lineJoin = 'round'
  const [a, b] = [s.pts[0], s.pts.at(-1)]
  if (s.kind === 'arrow') {
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    const head = s.width * 4.2
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 2) return c.restore()
    const ex = b.x - Math.cos(ang) * head * 0.8
    const ey = b.y - Math.sin(ang) * head * 0.8
    c.beginPath()
    c.moveTo(a.x, a.y)
    c.lineTo(ex, ey)
    c.stroke()
    c.beginPath()
    c.moveTo(b.x, b.y)
    c.lineTo(b.x - Math.cos(ang - 0.45) * head, b.y - Math.sin(ang - 0.45) * head)
    c.lineTo(b.x - Math.cos(ang + 0.45) * head, b.y - Math.sin(ang + 0.45) * head)
    c.closePath()
    c.fill()
  } else if (s.kind === 'rect') {
    c.beginPath()
    c.roundRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y), s.width)
    c.stroke()
  } else if (s.kind === 'ellipse') {
    c.beginPath()
    c.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
    c.stroke()
  } else if (s.kind === 'pen' || s.kind === 'highlight') {
    if (s.kind === 'highlight') {
      c.globalAlpha = 0.38
      c.lineWidth = s.width * 4
      c.lineCap = 'butt'
    }
    c.beginPath()
    s.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)))
    c.stroke()
  } else if (s.kind === 'text') {
    c.font = `600 ${s.width * 7}px 'Segoe UI', system-ui, sans-serif`
    c.textBaseline = 'top'
    // Тонкая обводка контрастным цветом — читается на любом фоне
    c.lineWidth = s.width * 0.9
    c.strokeStyle = isLight(s.color) ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)'
    c.strokeText(s.text, a.x, a.y)
    c.fillText(s.text, a.x, a.y)
  } else if (s.kind === 'step') {
    const r = s.width * 5
    c.beginPath()
    c.arc(a.x, a.y, r, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = isLight(s.color) ? '#111' : '#fff'
    c.font = `700 ${r * 1.15}px 'Segoe UI', system-ui, sans-serif`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(String(s.n), a.x, a.y + r * 0.06)
  }
  c.restore()
}

const isLight = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 170
}

TOOLS.annotate = () => {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e0244e'
  const COLORS = [accent, '#ffcc33', '#35d07f', '#3d8bff', '#ffffff', '#111111']
  let kind = 'arrow'
  let color = COLORS[0]
  let size = 2
  let shapes = []
  let undone = []
  let current = null
  const base = Math.max(img.width, img.height) / 400 // толщина линий — от размера картинки
  const width = () => base * [1, 1.8, 3][size - 1]

  section('Что рисуем')
  chips(
    [['arrow', 'Стрелка'], ['rect', 'Рамка'], ['ellipse', 'Овал'], ['pen', 'Карандаш'], ['highlight', 'Маркер'], ['text', 'Текст'], ['step', 'Шаг']],
    kind,
    (v) => (kind = v)
  )
  section('Цвет')
  const sw = el('div', 'swatches')
  COLORS.forEach((c, i) => {
    const b = el('button', 'swatch' + (i ? '' : ' active'))
    b.style.background = c
    b.addEventListener('click', () => {
      color = c
      sw.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('active', x === b))
    })
    sw.appendChild(b)
  })
  controls.appendChild(sw)
  section('Толщина')
  chips([[1, 'Тонко'], [2, 'Средне'], [3, 'Толсто']], size, (v) => (size = v))
  section('История')
  const hist = chips([['undo', ICON.undo + ' Назад'], ['redo', ICON.redo + ' Вперёд']], '', (v) => (v === 'undo' ? undo() : redo()))
  hist.select(null)
  hint('Ctrl+Z — отменить, Ctrl+Y — вернуть. Текст: щёлкни, напиши, Enter.')
  stage.classList.add('crosshair')

  const undo = () => {
    if (shapes.length) undone.push(shapes.pop()), redraw()
  }
  const redo = () => {
    if (undone.length) shapes.push(undone.pop()), redraw()
  }
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) undo()
    if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) redo()
  })
  const add = (s) => {
    shapes.push(s)
    undone = []
  }

  // Текст: поле ввода прямо на картинке
  function askText(p) {
    const input = Object.assign(el('input', 'text-input'), { type: 'text', placeholder: 'Текст…' })
    input.style.left = `${p.sx}px`
    input.style.top = `${p.sy}px`
    input.style.color = color
    input.style.fontSize = `${width() * 7 * box.k}px`
    stage.appendChild(input)
    setTimeout(() => input.focus())
    const done = (ok) => {
      if (!input.isConnected) return
      if (ok && input.value.trim()) add({ kind: 'text', color, width: width(), pts: [{ x: p.x, y: p.y }], text: input.value.trim() })
      input.remove()
      redraw()
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(true)
      if (e.key === 'Escape') (e.stopPropagation(), done(false))
    })
    input.addEventListener('blur', () => done(true))
  }

  return {
    suffix: 'пометки',
    render() {
      fitBox(img.width, img.height)
      ctx.save()
      ctx.translate(box.x, box.y)
      ctx.scale(box.k, box.k)
      ctx.drawImage(preview, 0, 0, img.width, img.height)
      for (const s of shapes) drawShape(ctx, s)
      if (current) drawShape(ctx, current)
      ctx.restore()
      setStatus(`<b>${shapes.length}</b> ${shapes.length === 1 ? 'пометка' : 'пометок'} · ${img.width} × ${img.height}`)
    },
    down(p) {
      if (kind === 'text') return askText(p)
      if (kind === 'step') {
        const n = shapes.filter((s) => s.kind === 'step').length + 1
        return add({ kind: 'step', color, width: width(), pts: [{ x: p.x, y: p.y }], n })
      }
      current = { kind, color, width: width(), pts: [{ x: p.x, y: p.y }, { x: p.x, y: p.y }] }
    },
    move(p) {
      if (!current) return
      if (current.kind === 'pen' || current.kind === 'highlight') current.pts.push({ x: p.x, y: p.y })
      else current.pts[1] = { x: p.x, y: p.y }
    },
    up() {
      if (current) {
        const [a, b] = [current.pts[0], current.pts.at(-1)]
        if (current.pts.length > 2 || Math.hypot(b.x - a.x, b.y - a.y) * box.k > 4) add(current)
      }
      current = null
    },
    reset() {
      shapes = []
      undone = []
    },
    export() {
      const out = newCanvas(img.width, img.height)
      const c = out.getContext('2d')
      c.drawImage(img, 0, 0)
      for (const s of shapes) drawShape(c, s)
      return out
    }
  }
}

// ===== Скрыть: замазать личное =====

// Применить закраски к холсту, где картинка нарисована в масштабе k
function applyRedactions(canvas, rects, k) {
  const c = canvas.getContext('2d')
  for (const r0 of rects) {
    const x = Math.max(0, Math.round(Math.min(r0.x, r0.x + r0.w) * k))
    const y = Math.max(0, Math.round(Math.min(r0.y, r0.y + r0.h) * k))
    const w = Math.min(canvas.width - x, Math.round(Math.abs(r0.w) * k))
    const h = Math.min(canvas.height - y, Math.round(Math.abs(r0.h) * k))
    if (w < 1 || h < 1) continue
    if (r0.mode === 'black') {
      c.fillStyle = '#000'
      c.fillRect(x, y, w, h)
    } else if (r0.mode === 'pixelate') {
      // Крупные квадраты: уменьшаем кусок и растягиваем обратно без сглаживания
      const f = Math.max(8 * k, Math.min(w, h) / 6)
      const tmp = newCanvas(Math.max(1, w / f), Math.max(1, h / f))
      tmp.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, tmp.width, tmp.height)
      c.save()
      c.imageSmoothingEnabled = false
      c.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h)
      c.restore()
    } else {
      // Размытие такое, что текст уже не прочитать; берём кусок с запасом, чтобы края не светлели
      const radius = Math.max(12 * k, Math.min(w, h) / 3)
      const pad = Math.ceil(radius * 2)
      const sx = Math.max(0, x - pad)
      const sy = Math.max(0, y - pad)
      const sw = Math.min(canvas.width, x + w + pad) - sx
      const sh = Math.min(canvas.height, y + h + pad) - sy
      const tmp = newCanvas(sw, sh)
      const t = tmp.getContext('2d')
      t.filter = `blur(${radius}px)`
      t.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
      // Второй проход — ещё сильнее
      const tmp2 = newCanvas(sw, sh)
      const t2 = tmp2.getContext('2d')
      t2.filter = `blur(${radius}px)`
      t2.drawImage(tmp, 0, 0)
      c.drawImage(tmp2, x - sx, y - sy, w, h, x, y, w, h)
    }
  }
}

TOOLS.redact = () => {
  let mode = 'black'
  let rects = []
  let current = null
  section('Как скрыть')
  chips([['black', 'Чёрным'], ['pixelate', 'Пикселями'], ['blur', 'Размытием']], mode, (v) => (mode = v))
  hint('Обведи то, что нужно спрятать: номер, адрес, лицо, пароль. Можно несколько областей.')
  hint('Чёрная заливка — самая надёжная: под ней ничего не восстановить.')
  section('История')
  chips([['undo', ICON.undo + ' Назад']], '', () => (rects.pop(), redraw())).select(null)
  stage.classList.add('crosshair')
  document.addEventListener('keydown', (e) => e.ctrlKey && e.key.toLowerCase() === 'z' && (rects.pop(), redraw()))

  return {
    suffix: 'скрыто',
    render() {
      fitBox(img.width, img.height)
      const k = preview.width / img.width
      const work = newCanvas(preview.width, preview.height)
      work.getContext('2d').drawImage(preview, 0, 0)
      applyRedactions(work, rects, k)
      ctx.drawImage(work, box.x, box.y, box.w, box.h)
      if (current) {
        ctx.save()
        ctx.setLineDash([6, 4])
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.strokeRect(box.x + current.x * box.k, box.y + current.y * box.k, current.w * box.k, current.h * box.k)
        ctx.restore()
      }
      setStatus(`<b>${rects.length}</b> ${rects.length === 1 ? 'область' : rects.length >= 2 && rects.length <= 4 ? 'области' : 'областей'}`)
    },
    down(p) {
      current = { x: clamp(p.x, 0, img.width), y: clamp(p.y, 0, img.height), w: 0, h: 0, mode }
    },
    move(p) {
      if (!current) return
      current.w = clamp(p.x, 0, img.width) - current.x
      current.h = clamp(p.y, 0, img.height) - current.y
    },
    up() {
      if (current && Math.abs(current.w * box.k) > 3 && Math.abs(current.h * box.k) > 3) rects.push(current)
      current = null
    },
    reset() {
      rects = []
    },
    export() {
      const out = newCanvas(img.width, img.height)
      out.getContext('2d').drawImage(img, 0, 0)
      applyRedactions(out, rects, 1)
      return out
    }
  }
}

// ===== Фон: картинка на градиенте с тенью =====

const BACKDROPS = [
  ['Клинок', ['#2a0716', '#b3123d']],
  ['Луна', ['#0b1626', '#2b4a66', '#d9e3ea']],
  ['Ночь', ['#050a14', '#123049']],
  ['Лепесток', ['#ffd6e2', '#ff7aa2']],
  ['Закат', ['#ff9a5a', '#ff3d6e', '#7b5cff']],
  ['Мята', ['#b8f3df', '#3fa7b5']],
  ['Графит', ['#1b1c20', '#3b3d45']],
  ['Белый', ['#ffffff']]
]
const ASPECTS = { auto: null, '1:1': 1, '4:3': 4 / 3, '16:9': 16 / 9, '9:16': 9 / 16, '4:5': 4 / 5 }

// Собрать картинку на фоне в масштабе k (1 — полный размер)
function composeBackdrop(src, k, o) {
  const w = img.width * k
  const h = img.height * k
  const pad = Math.max(w, h) * o.padding
  let cw = w + pad * 2
  let ch = h + pad * 2
  const r = ASPECTS[o.aspect]
  if (r) cw / ch < r ? (cw = ch * r) : (ch = cw / r)
  const out = newCanvas(cw, ch)
  const c = out.getContext('2d')
  // Градиент как в CSS: 0° — вверх, 90° — вправо
  const a = (o.angle * Math.PI) / 180
  const len = (Math.abs(out.width * Math.sin(a)) + Math.abs(out.height * Math.cos(a))) / 2
  const cx = out.width / 2
  const cy = out.height / 2
  if (o.colors.length === 1) c.fillStyle = o.colors[0]
  else {
    const g = c.createLinearGradient(cx - Math.sin(a) * len, cy + Math.cos(a) * len, cx + Math.sin(a) * len, cy - Math.cos(a) * len)
    o.colors.forEach((col, i) => g.addColorStop(i / (o.colors.length - 1), col))
    c.fillStyle = g
  }
  c.fillRect(0, 0, out.width, out.height)
  // Картинка со скруглёнными углами — отдельным слоем, чтобы тень повторяла её форму
  const radius = (Math.min(w, h) / 2) * (o.radius / 100)
  const layer = newCanvas(w, h)
  const l = layer.getContext('2d')
  l.beginPath()
  l.roundRect(0, 0, layer.width, layer.height, radius)
  l.clip()
  l.drawImage(src, 0, 0, layer.width, layer.height)
  const x = (out.width - layer.width) / 2
  const y = (out.height - layer.height) / 2
  if (o.shadow > 0) {
    const blur = Math.max(4 * k, Math.max(w, h) * 0.035)
    c.save()
    c.shadowColor = `rgba(0, 0, 0, ${0.65 * (o.shadow / 100)})`
    c.shadowBlur = blur * 2
    c.shadowOffsetY = blur * 0.6
    c.drawImage(layer, x, y)
    c.restore()
  }
  c.drawImage(layer, x, y)
  return out
}

TOOLS.bg = () => {
  const DEFAULT = { colors: BACKDROPS[0][1], angle: 135, padding: 12, radius: 8, shadow: 60, aspect: 'auto' }
  let o = { ...DEFAULT }
  const opts = () => ({ ...o, padding: o.padding / 100 })

  section('Фон')
  const sw = el('div', 'swatches')
  const swatchButtons = BACKDROPS.map(([name, cols], i) => {
    const b = el('button', 'swatch wide' + (i ? '' : ' active'))
    b.title = name
    b.style.background = cols.length > 1 ? `linear-gradient(135deg, ${cols.join(', ')})` : cols[0]
    b.addEventListener('click', () => {
      o.colors = cols
      swatchButtons.forEach((x) => x.classList.toggle('active', x === b))
      redraw()
    })
    sw.appendChild(b)
    return b
  })
  // Свои цвета
  const c1 = Object.assign(el('input'), { type: 'color', value: '#1d3b57', title: 'Свой цвет 1' })
  const c2 = Object.assign(el('input'), { type: 'color', value: '#c2185b', title: 'Свой цвет 2' })
  for (const input of [c1, c2]) {
    input.addEventListener('input', () => {
      o.colors = [c1.value, c2.value]
      swatchButtons.forEach((x) => x.classList.remove('active'))
      redraw()
    })
    sw.appendChild(input)
  }
  controls.appendChild(sw)
  section('Настройки')
  const s = {
    angle: slider('Угол градиента', 0, 360, o.angle, (v) => `${v}°`, (v) => ((o.angle = v), redraw()), 5),
    padding: slider('Поля', 0, 40, o.padding, (v) => `${v}%`, (v) => ((o.padding = v), redraw())),
    radius: slider('Скругление', 0, 50, o.radius, (v) => `${v}%`, (v) => ((o.radius = v), redraw())),
    shadow: slider('Тень', 0, 100, o.shadow, (v) => `${v}%`, (v) => ((o.shadow = v), redraw()))
  }
  section('Формат')
  const asp = chips([['auto', 'Авто'], ['1:1', '1:1'], ['4:3', '4:3'], ['16:9', '16:9'], ['9:16', '9:16'], ['4:5', '4:5']], o.aspect, (v) => ((o.aspect = v), redraw()))

  return {
    suffix: 'фон',
    ext: 'png',
    render() {
      const k = preview.width / img.width
      const out = composeBackdrop(preview, k, opts())
      fitBox(out.width, out.height)
      ctx.drawImage(out, box.x, box.y, box.w, box.h)
      // Итоговый размер — та же арифметика, что в composeBackdrop, но без рисования
      const pad = Math.max(img.width, img.height) * (o.padding / 100)
      let cw = img.width + pad * 2
      let ch = img.height + pad * 2
      const r = ASPECTS[o.aspect]
      if (r) cw / ch < r ? (cw = ch * r) : (ch = cw / r)
      setStatus(`<b>${Math.round(cw)} × ${Math.round(ch)}</b> · PNG`)
    },
    reset() {
      o = { ...DEFAULT }
      for (const k of Object.keys(s)) s[k].set(o[k])
      asp.select('auto')
      swatchButtons.forEach((x, i) => x.classList.toggle('active', !i))
    },
    export: () => composeBackdrop(img, 1, opts())
  }
}

// ===== Метаданные =====

const fmtDate = (s) => {
  const m = String(s).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/)
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` : s
}

TOOLS.meta = async () => {
  const isPdf = file.ext === 'pdf'
  const meta = (await window.familiar.toolMeta(file.path)) ?? {}
  const rows = []
  if (isPdf) rows.push(...(meta.fields ?? []))
  else {
    rows.push(['Размер', `${img.width} × ${img.height}`], ['Формат', file.ext.toUpperCase()], ['Вес', fmtSize(file.size)])
    const camera = meta.model && meta.make && meta.model.startsWith(meta.make) ? meta.model : [meta.make, meta.model].filter(Boolean).join(' ')
    if (camera) rows.push(['Камера', camera])
    if (meta.lens) rows.push(['Объектив', meta.lens])
    if (meta.date || meta.modified) rows.push(['Снято', fmtDate(meta.date || meta.modified)])
    if (meta.software) rows.push(['Программа', meta.software])
    if (meta.exposure) rows.push(['Выдержка', meta.exposure < 1 ? `1/${Math.round(1 / meta.exposure)} с` : `${meta.exposure} с`])
    if (meta.aperture) rows.push(['Диафрагма', `f/${meta.aperture.toFixed(1)}`])
    if (meta.iso) rows.push(['ISO', String(meta.iso)])
    if (meta.orientation > 1) rows.push(['Поворот', 'записан в EXIF'])
    if (meta.location) rows.push(['Геолокация', `${meta.location[0].toFixed(5)}, ${meta.location[1].toFixed(5)}`, 'alert'])
    else if (meta.gps) rows.push(['Геолокация', 'есть', 'alert'])
    if (meta.tags) rows.push(['Всего тегов EXIF', String(meta.tags)])
  }

  section(isPdf ? 'Свойства документа' : 'Что записано в файле')
  const table = el('table', 'meta')
  for (const [k, v, cls] of rows) {
    const tr = el('tr', cls)
    tr.append(el('td', null, k), el('td', null, v))
    table.appendChild(tr)
  }
  controls.appendChild(table)
  const has = isPdf ? meta.hasMeta : meta.hasMeta || meta.gps
  if (!has) controls.appendChild(el('div', 'empty', 'Лишних данных нет — убирать нечего.'))
  else if (meta.gps) hint('Геолокация показывает, где сделан снимок. Отправляешь фото чужим — лучше убрать.')

  // Кнопки: «Убрать геолокацию» (если есть) и «Убрать всё»
  resetBtn.textContent = meta.gps ? 'Убрать GPS' : 'Закрыть'
  saveBtn.textContent = 'Убрать всё'
  saveBtn.disabled = !has
  return {
    narrow: isPdf,
    render() {
      if (isPdf) return
      fitBox(img.width, img.height)
      ctx.drawImage(preview, box.x, box.y, box.w, box.h)
      setStatus(`<b>${img.width} × ${img.height}</b> · ${fmtSize(file.size)}`)
    },
    async reset() {
      if (!meta.gps) return window.close()
      const res = await window.familiar.toolRun('img-no-location', [file.path])
      if (!res?.error) window.close()
    },
    async save() {
      const res = await window.familiar.toolRun(isPdf ? 'pdf-meta-strip' : 'clean', [file.path])
      return !res?.error
    }
  }
}

// ===== Сжать (несколько файлов) =====

// Уменьшить картинку плавно: по половинке за шаг — так мелкие детали не «рвутся»
function scaleTo(src, w, h) {
  let cur = src
  let cw = src.width
  let ch = src.height
  while (cw / 2 > w && ch / 2 > h) {
    const half = newCanvas(cw / 2, ch / 2)
    const c = half.getContext('2d')
    c.imageSmoothingQuality = 'high'
    c.drawImage(cur, 0, 0, half.width, half.height)
    cur = half
    cw = half.width
    ch = half.height
  }
  const out = newCanvas(w, h)
  const c = out.getContext('2d')
  c.imageSmoothingQuality = 'high'
  c.drawImage(cur, 0, 0, out.width, out.height)
  return out
}

TOOLS.compress = () => {
  // Начальные качество и цель — из «Настройки → Конвертер»
  const startQuality = clamp(Math.round(+params.get('quality') * 100) || 75, 30, 95)
  let o = { mode: 'quality', quality: startQuality, targetKb: +params.get('target') || 500, format: 'same', maxSide: 0 }
  let result = null // { bytes, bitmap, w, h, q }
  let busy = false
  let again = false
  let split = 0.5
  let zoom = 'fit'
  let pan = null
  let center = { x: img.width / 2, y: img.height / 2 }
  const many = FILES.length > 1

  section('Как сжимать')
  chips([['quality', 'По качеству'], ['target', 'До размера']], o.mode, (v) => {
    o.mode = v
    q.style.display = v === 'quality' ? '' : 'none'
    tRow.style.display = tField.style.display = v === 'target' ? '' : 'none'
    estimate()
  })
  const q = slider('Качество', 30, 95, o.quality, (v) => v, (v) => ((o.quality = v), estimate()))
  const tRow = chips([[200, '200 КБ'], [500, '500 КБ'], [1024, '1 МБ'], [2048, '2 МБ']], o.targetKb, (v) => {
    o.targetKb = v
    tIn.value = v
    estimate()
  })
  const tField = el('div', 'field')
  const tIn = Object.assign(el('input'), { type: 'number', min: 20, value: o.targetKb })
  tField.append(tIn, el('span', 'unit', 'КБ'))
  controls.appendChild(tField)
  tIn.addEventListener('change', () => {
    o.targetKb = Math.max(20, +tIn.value || 500)
    tRow.select(o.targetKb)
    estimate()
  })
  tRow.style.display = tField.style.display = 'none'
  section('Формат')
  chips([['same', 'Как было'], ['jpg', 'JPG'], ['webp', 'WebP']], o.format, (v) => ((o.format = v), estimate()))
  section('Длинная сторона')
  chips([[0, 'Как есть'], [3840, '3840'], [2560, '2560'], [1920, '1920'], [1280, '1280']], 0, (v) => ((o.maxSide = v), estimate()))
  if (many) hint(`Настройки применятся ко всем ${FILES.length} файлам. Превью — по первому.`)
  section('Просмотр')
  chips([['fit', 'Целиком'], ['1:1', '1:1 — детали']], zoom, (v) => ((zoom = v), redraw()))
  hint('Тяни разделитель, чтобы сравнить «было» и «стало».')

  // PNG сжимается только сменой формата — по умолчанию он становится WebP
  const formatFor = (ext) => {
    if (o.format !== 'same') return o.format
    const e = outExt(ext)
    return e === 'png' ? 'webp' : e
  }

  // Сжать один файл; возвращает байты и подобранное качество
  async function compressOne(src, ext, onlyEstimate = false) {
    const fmt = formatFor(ext)
    let w = src.width
    let h = src.height
    if (o.maxSide && Math.max(w, h) > o.maxSide) {
      const k = o.maxSide / Math.max(w, h)
      w = Math.round(w * k)
      h = Math.round(h * k)
    }
    let canvas = w === src.width && h === src.height ? null : scaleTo(src, w, h)
    if (!canvas) {
      canvas = newCanvas(w, h)
      canvas.getContext('2d').drawImage(src, 0, 0)
    }
    if (o.mode === 'quality') return { bytes: await encode(canvas, fmt, o.quality / 100), q: o.quality, fmt, w, h }
    // До размера: качество двоичным поиском, если не влезает — уменьшаем картинку
    const target = o.targetKb * 1024
    for (let attempt = 0; attempt < 8; attempt++) {
      let lo = 30
      let hi = 92
      let best = null
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const bytes = await encode(canvas, fmt, mid / 100)
        if (bytes.length <= target) (best = { bytes, q: mid }), (lo = mid + 1)
        else hi = mid - 1
      }
      if (best) return { ...best, fmt, w: canvas.width, h: canvas.height }
      canvas = scaleTo(canvas, canvas.width * 0.8, canvas.height * 0.8)
      if (onlyEstimate && attempt > 5) break
    }
    throw new Error('Так сильно не сжать')
  }

  async function estimate() {
    if (busy) return (again = true)
    busy = true
    setStatus('считаю…')
    try {
      const r = await compressOne(img, file.ext, true)
      result = { ...r, bitmap: await createImageBitmap(new Blob([r.bytes])) }
    } catch (err) {
      result = null
      setStatus(err.message)
    }
    busy = false
    if (again) return (again = false), estimate()
    redraw()
  }

  estimate()
  return {
    suffix: 'сжато',
    render() {
      fitBox(img.width, img.height)
      if (zoom === '1:1') {
        // Пиксель в пиксель (с учётом масштаба экрана): видно артефакты сжатия
        const k = 1 / dpr
        const w = stage.clientWidth
        const h = stage.clientHeight
        center.x = clamp(center.x, Math.min(img.width / 2, (w / k) / 2), Math.max(img.width / 2, img.width - (w / k) / 2))
        center.y = clamp(center.y, Math.min(img.height / 2, (h / k) / 2), Math.max(img.height / 2, img.height - (h / k) / 2))
        box = { k, w: img.width * k, h: img.height * k, x: w / 2 - center.x * k, y: h / 2 - center.y * k }
      }
      const cut = box.x + box.w * split
      ctx.save()
      ctx.drawImage(img, box.x, box.y, box.w, box.h)
      if (result) {
        ctx.beginPath()
        ctx.rect(cut, 0, stage.clientWidth, stage.clientHeight)
        ctx.clip()
        ctx.drawImage(result.bitmap, box.x, box.y, box.w, box.h)
      }
      ctx.restore()
      // Разделитель
      ctx.fillStyle = '#fff'
      ctx.fillRect(Math.round(cut) - 1, Math.max(0, box.y), 2, Math.min(stage.clientHeight, box.h))
      ctx.beginPath()
      ctx.arc(cut, clamp(box.y + box.h / 2, 20, stage.clientHeight - 50), 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.font = '10px ' + getComputedStyle(document.body).getPropertyValue('--mono')
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillText('БЫЛО', Math.max(12, box.x + 10), Math.max(22, box.y + 20))
      ctx.fillText('СТАЛО', Math.min(stage.clientWidth - 50, box.x + box.w - 48), Math.max(22, box.y + 20))
      if (result) {
        const delta = Math.round((1 - result.bytes.length / file.size) * 100)
        setStatus(`${fmtSize(file.size)} → <b>${fmtSize(result.bytes.length)}</b> (${delta >= 0 ? '−' : '+'}${Math.abs(delta)}%) · ${result.w} × ${result.h} · ${result.fmt.toUpperCase()} ${result.q}`)
      }
    },
    down(p) {
      const cut = box.x + box.w * split
      pan = Math.abs(p.sx - cut) < 14 || zoom === 'fit' ? 'split' : { sx: p.sx, sy: p.sy, c: { ...center } }
      if (pan === 'split') split = clamp((p.sx - box.x) / box.w, 0, 1)
    },
    move(p) {
      if (pan === 'split') split = clamp((p.sx - box.x) / box.w, 0, 1)
      else if (pan) center = { x: pan.c.x - (p.sx - pan.sx) / box.k, y: pan.c.y - (p.sy - pan.sy) / box.k }
    },
    hover(p) {
      view.style.cursor = Math.abs(p.sx - (box.x + box.w * split)) < 14 || zoom === 'fit' ? 'ew-resize' : 'grab'
    },
    up() {
      pan = null
    },
    reset() {
      o = { ...o, quality: startQuality }
      q.set(startQuality)
      estimate()
    },
    async save() {
      let saved = 0
      for (const p of FILES) {
        const f = p === file.path ? file : await window.familiar.toolRead(p)
        // Уже меньше цели — трогать незачем
        if (o.mode === 'target' && f.size <= o.targetKb * 1024 && !o.maxSide) continue
        const src = p === file.path ? img : (await loadImage(f.bytes)).bitmap
        const r = await compressOne(src, f.ext)
        // Сжатая копия вышла тяжелее оригинала — такая не нужна
        if (r.bytes.length >= f.size && !o.maxSide && r.fmt === outExt(f.ext)) continue
        await window.familiar.toolSave(p, o.mode === 'target' ? `до ${o.targetKb >= 1024 ? o.targetKb / 1024 + ' МБ' : o.targetKb + ' КБ'}` : 'сжато', r.fmt, r.bytes)
        saved++
      }
      if (!saved) setStatus('Файлы уже сжаты сильнее — сохранять нечего')
      return saved > 0
    }
  }
}

// ===== Размер (несколько файлов) =====

TOOLS.resize = () => {
  let preset = '50%'
  let lock = true
  let custom = null
  const size = (W, H) => {
    if (custom) {
      if (!lock) return [custom.w, custom.h]
      const k = Math.max(custom.w, custom.h) / Math.max(W, H)
      return [Math.max(1, Math.round(W * k)), Math.max(1, Math.round(H * k))]
    }
    if (preset.endsWith('%')) {
      const k = parseInt(preset) / 100
      return [Math.max(1, Math.round(W * k)), Math.max(1, Math.round(H * k))]
    }
    const side = +preset
    const k = Math.min(1, side / Math.max(W, H)) // не увеличиваем
    return [Math.round(W * k), Math.round(H * k)]
  }
  section('Готовые размеры')
  const pr = chips([['50%', '50%'], ['25%', '25%'], ['3840', '4K'], ['2560', '2560'], ['1920', 'Full HD'], ['1280', '1280'], ['800', '800']], preset, (v) => {
    preset = v
    custom = null
    sync()
  })
  section('Свой размер')
  const row = el('div', 'field')
  const wIn = Object.assign(el('input'), { type: 'number', min: 1 })
  const hIn = Object.assign(el('input'), { type: 'number', min: 1 })
  row.append(wIn, el('span', 'unit', '×'), hIn, el('span', 'unit', 'px'))
  controls.appendChild(row)
  chips([[true, 'Сохранять пропорции'], [false, 'Свободно']], lock, (v) => ((lock = v), sync()))
  if (FILES.length > 1) hint(`Применится к ${FILES.length} файлам. Готовые размеры — по длинной стороне, меньше не станут больше.`)
  const sync = () => {
    const [w, h] = size(img.width, img.height)
    wIn.value = w
    hIn.value = h
    redraw()
  }
  const typed = (which) => {
    pr.select(null)
    let w = Math.max(1, +wIn.value || 1)
    let h = Math.max(1, +hIn.value || 1)
    if (lock) which === 'w' ? (h = Math.round((w * img.height) / img.width)) : (w = Math.round((h * img.width) / img.height))
    custom = { w, h }
    sync()
  }
  wIn.addEventListener('change', () => typed('w'))
  hIn.addEventListener('change', () => typed('h'))
  sync()

  return {
    render() {
      const [w, h] = size(img.width, img.height)
      fitBox(img.width, img.height)
      ctx.drawImage(preview, box.x, box.y, box.w, box.h)
      setStatus(`${img.width} × ${img.height} → <b>${w} × ${h}</b>`)
    },
    reset() {
      preset = '50%'
      custom = null
      pr.select('50%')
      sync()
    },
    async save() {
      for (const p of FILES) {
        const f = p === file.path ? file : await window.familiar.toolRead(p)
        const src = p === file.path ? img : (await loadImage(f.bytes)).bitmap
        const [w, h] = size(src.width, src.height)
        const ext = outExt(f.ext)
        await window.familiar.toolSave(p, `${w}×${h}`, ext, await encode(scaleTo(src, w, h), ext))
      }
      return true
    }
  }
}

// ===== Пароль на PDF =====

TOOLS.protect = () => {
  section('Пароль')
  const f1 = el('div', 'field')
  const p1 = Object.assign(el('input'), { type: 'password', placeholder: 'Пароль', autocomplete: 'new-password' })
  f1.appendChild(p1)
  const f2 = el('div', 'field')
  const p2 = Object.assign(el('input'), { type: 'password', placeholder: 'Ещё раз', autocomplete: 'new-password' })
  f2.appendChild(p2)
  controls.append(f1, f2)
  const meter = el('div', 'meter')
  const bar = el('i')
  meter.appendChild(bar)
  controls.appendChild(meter)
  const note = el('p', 'hint', '')
  controls.appendChild(note)
  chips([['hide', 'Скрыть'], ['show', 'Показать']], 'hide', (v) => (p1.type = p2.type = v === 'show' ? 'text' : 'password'))
  hint('Шифрование AES-256. Без пароля файл не открыть — и восстановить пароль нельзя, запиши его.')
  hint('Сохранится копия «… (с паролем).pdf», оригинал останется как был.')
  setTimeout(() => p1.focus())

  // Грубая оценка: длина и разнообразие символов
  const check = () => {
    const v = p1.value
    const kinds = [/[a-zа-яё]/, /[A-ZА-ЯЁ]/, /\d/, /[^\wа-яё]/i].filter((r) => r.test(v)).length
    const score = Math.min(4, Math.floor(v.length / 4) + kinds - 1)
    bar.style.width = `${v ? Math.max(10, score * 25) : 0}%`
    const same = v && v === p2.value
    note.textContent = !v ? '' : p2.value && !same ? 'Пароли не совпадают' : ['Очень слабый', 'Слабый', 'Средний', 'Хороший', 'Надёжный'][Math.max(0, score)]
    saveBtn.disabled = !same
  }
  p1.addEventListener('input', check)
  p2.addEventListener('input', check)
  check()
  saveBtn.textContent = 'Запереть'
  resetBtn.textContent = 'Отмена'
  for (const p of [p1, p2]) p.addEventListener('keydown', (e) => e.key === 'Enter' && !saveBtn.disabled && saveBtn.click())
  return {
    narrow: true,
    reset: () => window.close(),
    async save() {
      const res = await window.familiar.toolRun('pdf-protect', [file.path], { password: p1.value })
      if (res?.error) note.textContent = res.error
      return !res?.error
    }
  }
}

// ---------- Запуск ----------

const TITLES = {
  crop: 'ОБРЕЗАТЬ', edit: 'ПРАВКА', annotate: 'ПОМЕТКИ', redact: 'СКРЫТЬ', bg: 'ФОН',
  meta: 'МЕТАДАННЫЕ', compress: 'СЖАТЬ', resize: 'РАЗМЕР', protect: 'ПАРОЛЬ'
}
let tool = {}

async function start() {
  $('title').textContent = TITLES[TOOL] ?? 'ИНСТРУМЕНТ'
  document.title = (TITLES[TOOL] ?? '').toLowerCase()
  file = await window.familiar.toolRead(FILES[0])
  if (!file) return window.close()
  file.bytes = new Uint8Array(file.bytes)
  $('file').textContent = FILES.length > 1 ? `${file.name} и ещё ${FILES.length - 1}` : file.name
  if (file.ext !== 'pdf') {
    try {
      const loaded = await loadImage(file.bytes)
      img = loaded.bitmap
      preview = loaded.small
    } catch {
      controls.appendChild(el('div', 'empty', 'Не получилось открыть картинку.'))
      saveBtn.disabled = true
      return
    }
  }
  tool = await TOOLS[TOOL]()
  if (tool.narrow) $('layout').classList.add('narrow'), (stage.style.display = 'none')
  new ResizeObserver(resizeView).observe(stage)
  resizeView()
}

resetBtn.addEventListener('click', () => {
  tool.reset?.()
  redraw()
})

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true
  const label = saveBtn.textContent
  saveBtn.textContent = 'Сохраняю…'
  try {
    let ok = true
    if (tool.save) ok = await tool.save()
    else {
      const ext = tool.ext ?? outExt(file.ext)
      await window.familiar.toolSave(file.path, tool.suffix, ext, await encode(tool.export(), ext))
    }
    // Готово — уведомление с «Открыть» и «Отменить» показывает главный процесс
    if (ok) return window.close()
  } catch (err) {
    setStatus(`Не получилось: ${err.message}`)
  }
  saveBtn.textContent = label
  saveBtn.disabled = false
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.tagName !== 'INPUT') window.close()
  if (e.ctrlKey && e.key.toLowerCase() === 's') (e.preventDefault(), saveBtn.disabled || saveBtn.click())
})

start()
