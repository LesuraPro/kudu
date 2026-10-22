// Палитры оформления. Цвета — это CSS-переменные из src/theme.css; здесь мы собираем их
// значения для тёмной и светлой темы и отдаём окнам готовым куском CSS (его вставляет preload).
//   moon     — «Луна и клинок»: снято с обоев Лёхи (рыцарь в чёрной туши, малиновые клинки,
//              огромная бледная луна, сине-бирюзовая ночь, розовые лепестки). По умолчанию.
//   nothing  — прежний стиль: чёрное стекло и красный акцент, как у телефонов Nothing.
//   wallpaper — подбирается автоматически по своим обоям (см. fromImage).

// ---------- Цвет: мелкие преобразования ----------

const hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
const rgbOf = (h) => {
  const n = parseInt(h.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}
const rgba = (h, a) => `rgba(${rgbOf(h).join(', ')}, ${a})`

function hsl(h, s, l) {
  s /= 100
  l /= 100
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return hex(f(0) * 255, f(8) * 255, f(4) * 255)
}

function toHsl([r, g, b]) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s * 100, l * 100]
}

// ---------- Палитра из нескольких опорных цветов ----------
// base — фон (тёмный), text — текст (светлый), muted — подписи, accent — акцент, petal — второй акцент

function build({ base, text, muted, accent, petal, lightBase, lightStrong, lightText, lightMuted, lightAccent }) {
  const [bh, bs] = toHsl(rgbOf(base))
  const strong = hsl(bh, Math.min(bs, 60), Math.min(12, toHsl(rgbOf(base))[2] + 2.5))
  const dark = {
    '--bg': rgba(base, 0.9),
    '--bg-strong': rgba(strong, 0.97),
    '--solid': strong,
    '--border': rgba(text, 0.1),
    '--border-strong': rgba(text, 0.24),
    '--text': text,
    '--muted': muted,
    '--dot-off': rgba(text, 0.1),
    '--accent': accent,
    '--accent-glow': rgba(accent, 0.45),
    '--accent-soft': rgba(accent, 0.16),
    '--on-accent': '#ffffff',
    '--petal': petal,
    '--hover': rgba(text, 0.07),
    '--shadow': `0 2px 6px ${rgba(hsl(bh, 60, 2), 0.5)}`,
    '--edge': `inset 0 1px 0 ${rgba(text, 0.08)}`,
    '--texture': `radial-gradient(circle, ${rgba(text, 0.04)} 1px, transparent 1.4px)`,
    '--stage': `conic-gradient(${rgba(text, 0.035)} 25%, transparent 0 50%, ${rgba(text, 0.035)} 0 75%, transparent 0) 0 0 / 22px 22px, ${hsl(bh, Math.min(bs, 50), 4)}`
  }
  const light = {
    '--bg': rgba(lightBase, 0.93),
    '--bg-strong': rgba(lightStrong, 0.97),
    '--solid': lightStrong,
    '--border': rgba(lightText, 0.1),
    '--border-strong': rgba(lightText, 0.22),
    '--text': lightText,
    '--muted': lightMuted,
    '--dot-off': rgba(lightText, 0.1),
    '--accent': lightAccent,
    '--accent-glow': rgba(lightAccent, 0.3),
    '--accent-soft': rgba(lightAccent, 0.12),
    '--on-accent': '#ffffff',
    '--petal': petal,
    '--hover': rgba(lightText, 0.06),
    '--shadow': `0 2px 6px ${rgba(lightText, 0.14)}`,
    '--edge': 'inset 0 1px 0 rgba(255, 255, 255, 0.85)',
    '--texture': `radial-gradient(circle, ${rgba(lightText, 0.05)} 1px, transparent 1.4px)`,
    '--stage': `conic-gradient(${rgba(lightText, 0.05)} 25%, transparent 0 50%, ${rgba(lightText, 0.05)} 0 75%, transparent 0) 0 0 / 22px 22px, ${lightBase}`
  }
  // Остров всегда тёмный (как Dynamic Island) — его цвета от темы не зависят
  const island = {
    '--ink': hsl(bh, Math.min(bs, 70), 2.5),
    '--ink-text': text,
    '--ink-dim': muted,
    '--ink-muted': rgba(text, 0.45),
    '--ink-line': rgba(text, 0.1)
  }
  return { dark: { ...dark, ...island }, light: { ...light, ...island }, solid: { dark: strong, light: lightStrong }, accent, text }
}

const PRESETS = {
  moon: build({
    base: '#050f16', // чернила с синевой ночного неба
    text: '#e3eef0', // лунный свет
    muted: '#7f9198', // сталь доспеха
    accent: '#f0195b', // светящийся малиновый клинок
    petal: '#f29ac8', // лепестки
    lightBase: '#e6eff1', // светлая тема — сама луна
    lightStrong: '#eef5f7',
    lightText: '#06141c',
    lightMuted: '#536a75',
    lightAccent: '#d3124f'
  }),
  nothing: build({
    base: '#0a0a0c',
    text: '#f2f2f2',
    muted: '#8b8b90',
    accent: '#ff2d2d',
    petal: '#ff8a8a',
    lightBase: '#f0f0f0',
    lightStrong: '#fafafa',
    lightText: '#111111',
    lightMuted: '#6b6b70',
    lightAccent: '#e8261f'
  })
}

// ---------- Палитра из обоев ----------
// pixels — уменьшенная картинка: BGRA (как отдаёт nativeImage.toBitmap) или RGBA (canvas).
// Фон — тёмные места обоев, акцент — самый заметный насыщенный оттенок, текст — светлый
// с лёгким оттенком фона. Яркость подгоняем, чтобы всё читалось

function fromPixels(pixels, { rgba = false } = {}) {
  const hues = new Float64Array(36) // корзины по 10°
  let darkSum = [0, 0, 0]
  let darkN = 0
  let lightSum = [0, 0, 0]
  let lightN = 0
  const chromaOf = (rgb) => (Math.max(...rgb) - Math.min(...rgb)) / 255
  const px = []
  for (let i = 0; i < pixels.length; i += 4) {
    const rgb = rgba ? [pixels[i], pixels[i + 1], pixels[i + 2]] : [pixels[i + 2], pixels[i + 1], pixels[i]]
    const [h, , l] = toHsl(rgb)
    px.push([h, chromaOf(rgb)])
    if (l < 30) (darkSum = darkSum.map((v, k) => v + rgb[k])), darkN++
    if (l > 70) (lightSum = lightSum.map((v, k) => v + rgb[k])), lightN++
  }
  const avg = (sum, n, fallback) => (n ? sum.map((v) => v / n) : fallback)
  const [bh, bsRaw] = toHsl(avg(darkSum, darkN, [10, 12, 16]))
  const bs = Math.min(bsRaw, 55)
  // Акцент — самое «сочное» (по хроме, а не по насыщенности: тёмно-синее небо насыщенное,
  // но не яркое) и при этом непохожее на фон. Мелкий светящийся клинок важнее огромного неба
  for (const [h, chroma] of px) {
    if (chroma < 0.25) continue
    const dist = Math.min(Math.abs(h - bh), 360 - Math.abs(h - bh))
    hues[Math.floor(h / 10) % 36] += chroma ** 3 * (0.3 + (0.7 * dist) / 180)
  }
  // Самый «громкий» оттенок, сглаженный с соседями
  let best = 0
  let bestW = -1
  for (let i = 0; i < 36; i++) {
    const w = hues[i] + 0.5 * (hues[(i + 35) % 36] + hues[(i + 1) % 36])
    if (w > bestW) (bestW = w), (best = i)
  }
  const accentHue = bestW > 0.3 ? best * 10 + 5 : 350 // нет ярких цветов — малиновый по умолчанию
  const [th, ts] = toHsl(avg(lightSum, lightN, [235, 238, 240]))
  return build({
    base: hsl(bh, bs, 5),
    text: hsl(lightN ? th : bh, Math.min(ts, 22), 92),
    muted: hsl(bh, Math.min(bs, 14), 56),
    accent: hsl(accentHue, 88, 54),
    petal: hsl((accentHue + 330) % 360, 75, 76),
    lightBase: hsl(bh, Math.min(bs, 25), 93),
    lightStrong: hsl(bh, Math.min(bs, 25), 96.5),
    lightText: hsl(bh, Math.min(bs, 60), 7),
    lightMuted: hsl(bh, Math.min(bs, 15), 38),
    lightAccent: hsl(accentHue, 85, 44)
  })
}

// Готовый кусок CSS для вставки в окно
function toCss(p) {
  const block = (vars) => Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n')
  return `:root {\n${block(p.dark)}\n}\n@media (prefers-color-scheme: light) {\n  :root {\n${block(p.light)}\n  }\n}`
}

module.exports = { PRESETS, fromPixels, toCss }
