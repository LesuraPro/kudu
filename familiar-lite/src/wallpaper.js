// Генератор обоев в стиле Familiar/Nothing.
// Wallpapers.draw(ctx, style, W, H) рисует на любом canvas — так работают и сами обои,
// и превью в настройках. window.renderWallpaper() нужен скрытому окну из main.js.
;(() => {
  function draw(ctx, style, W, H) {
    const S = Math.min(W, H) / 1080 // масштаб относительно Full HD

    // Предсказуемый «случайный» генератор — одинаковые обои при каждом нажатии
    let seed = 42
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647

    function dotGrid(step, r, color, mask = () => 1) {
      for (let y = step / 2; y < H; y += step) {
        for (let x = step / 2; x < W; x += step) {
          const k = mask(x, y)
          if (k <= 0) continue
          ctx.globalAlpha = k
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(x, y, r, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }

    const styles = {
      // «Луна и клинок» — по мотивам обоев Лёхи: сине-бирюзовая ночь, огромная бледная луна,
      // взрыв чёрной туши, два светящихся малиновых клинка крест-накрест и розовые лепестки
      moon() {
        const sky = ctx.createLinearGradient(0, 0, W, 0)
        sky.addColorStop(0, '#010d14')
        sky.addColorStop(0.45, '#04222f')
        sky.addColorStop(1, '#0a2c3b')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, W, H)

        // Луна с ореолом
        const cx = W * 0.56
        const cy = H * 0.5
        const R = H * 0.47
        const halo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.6)
        halo.addColorStop(0, 'rgba(160, 205, 220, 0.35)')
        halo.addColorStop(1, 'rgba(160, 205, 220, 0)')
        ctx.fillStyle = halo
        ctx.fillRect(0, 0, W, H)
        const disc = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.1, cx, cy, R)
        disc.addColorStop(0, '#f1f7f8')
        disc.addColorStop(0.6, '#d3e2e6')
        disc.addColorStop(1, '#a9c0c6')
        ctx.fillStyle = disc
        ctx.beginPath()
        ctx.arc(cx, cy, R, 0, Math.PI * 2)
        ctx.fill()
        // «Моря» и кратеры — мягкие пятна внутри диска
        ctx.save()
        ctx.beginPath()
        ctx.arc(cx, cy, R, 0, Math.PI * 2)
        ctx.clip()
        for (let i = 0; i < 70; i++) {
          const a = rnd() * Math.PI * 2
          const d = Math.sqrt(rnd()) * R
          const r = (0.03 + rnd() * 0.16) * R
          const g = ctx.createRadialGradient(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0, cx + Math.cos(a) * d, cy + Math.sin(a) * d, r)
          g.addColorStop(0, `rgba(120, 150, 160, ${0.12 + rnd() * 0.18})`)
          g.addColorStop(1, 'rgba(120, 150, 160, 0)')
          ctx.fillStyle = g
          ctx.fillRect(cx + Math.cos(a) * d - r, cy + Math.sin(a) * d - r, r * 2, r * 2)
        }
        ctx.restore()

        // Взрыв туши: плавные изогнутые мазки, сужающиеся к концу, — как дым или тушь в воде.
        // Каждый мазок — кривая Безье, обведённая «лентой» переменной ширины
        const INK = '#010304'
        const wisp = (x0, y0, ang, len, w0, curl) => {
          const p1 = [x0 + Math.cos(ang) * len * 0.35, y0 + Math.sin(ang) * len * 0.35]
          const a2 = ang + curl
          const p2 = [x0 + Math.cos(ang + curl * 0.4) * len * 0.7, y0 + Math.sin(ang + curl * 0.4) * len * 0.7]
          const p3 = [p2[0] + Math.cos(a2) * len * 0.35, p2[1] + Math.sin(a2) * len * 0.35]
          const at = (t) => {
            const u = 1 - t
            return [
              u * u * u * x0 + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
              u * u * u * y0 + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
            ]
          }
          const left = []
          const right = []
          const N = 40
          const wobble = rnd() * 10
          for (let i = 0; i <= N; i++) {
            const t = i / N
            const [x, y] = at(t)
            const [x2, y2] = at(Math.min(1, t + 0.01))
            const a = Math.atan2(y2 - y, x2 - x) + Math.PI / 2
            const w = w0 * Math.pow(1 - t, 0.9) * (0.75 + 0.25 * Math.sin(t * 9 + wobble))
            left.push([x + Math.cos(a) * w, y + Math.sin(a) * w])
            right.push([x - Math.cos(a) * w, y - Math.sin(a) * w])
          }
          ctx.beginPath()
          left.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
          right.reverse().forEach(([x, y]) => ctx.lineTo(x, y))
          ctx.closePath()
          ctx.fill()
          return p3
        }
        ctx.fillStyle = INK
        // Ядро — плотная масса, чуть вытянутая вверх
        for (let i = 0; i < 26; i++) {
          const a = rnd() * Math.PI * 2
          wisp(cx + Math.cos(a) * R * 0.08, cy + Math.sin(a) * R * 0.12, a, R * (0.28 + rnd() * 0.25), R * (0.1 + rnd() * 0.06), (rnd() - 0.5) * 1.2)
        }
        // Длинные языки: больше вверх и в стороны, закручиваются
        for (let i = 0; i < 34; i++) {
          const up = rnd() < 0.62
          const a = up ? -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.25 : Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.1
          const end = wisp(cx + (rnd() - 0.5) * R * 0.2, cy + (rnd() - 0.5) * R * 0.3, a, R * (0.55 + rnd() * 0.75), R * (0.025 + rnd() * 0.045), (rnd() - 0.5) * 2.4)
          // Брызги на конце языка
          for (let k = 0; k < 4; k++) {
            ctx.globalAlpha = 0.6 + rnd() * 0.4
            ctx.beginPath()
            ctx.arc(end[0] + (rnd() - 0.5) * R * 0.12, end[1] + (rnd() - 0.5) * R * 0.12, (0.8 + rnd() * 2.6) * S, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.globalAlpha = 1
        }
        // Мелкие капли вокруг
        for (let i = 0; i < 160; i++) {
          const a = rnd() * Math.PI * 2
          const d = R * (0.4 + rnd() * 1.05)
          ctx.globalAlpha = 0.35 + rnd() * 0.6
          ctx.beginPath()
          ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9, (0.5 + rnd() * 2.4) * S, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1

        // Два клинка крест-накрест: широкие у гарды, сужаются к острию, светятся малиновым,
        // внутри — тёмные прожилки, как трещины в раскалённом металле
        const blade = (x0, y0, x1, y1, w0) => {
          const ang = Math.atan2(y1 - y0, x1 - x0)
          const len = Math.hypot(x1 - x0, y1 - y0)
          const nx = Math.cos(ang + Math.PI / 2)
          const ny = Math.sin(ang + Math.PI / 2)
          const shape = () => {
            ctx.beginPath()
            ctx.moveTo(x0 + nx * w0, y0 + ny * w0)
            ctx.quadraticCurveTo(x0 + Math.cos(ang) * len * 0.6 + nx * w0 * 1.15, y0 + Math.sin(ang) * len * 0.6 + ny * w0 * 1.15, x1 + nx * w0 * 0.25, y1 + ny * w0 * 0.25)
            ctx.lineTo(x1 + Math.cos(ang) * w0 * 1.4, y1 + Math.sin(ang) * w0 * 1.4)
            ctx.lineTo(x1 - nx * w0 * 0.25, y1 - ny * w0 * 0.25)
            ctx.quadraticCurveTo(x0 + Math.cos(ang) * len * 0.6 - nx * w0 * 1.15, y0 + Math.sin(ang) * len * 0.6 - ny * w0 * 1.15, x0 - nx * w0, y0 - ny * w0)
            ctx.closePath()
          }
          const g = ctx.createLinearGradient(x0, y0, x1, y1)
          g.addColorStop(0, '#3a0414')
          g.addColorStop(0.35, '#9e0e3c')
          g.addColorStop(1, '#ff2a6a')
          ctx.save()
          ctx.shadowColor = '#f0195b'
          ctx.shadowBlur = 46 * S
          ctx.fillStyle = g
          shape()
          ctx.fill()
          ctx.restore()
          // Прожилки
          ctx.save()
          shape()
          ctx.clip()
          ctx.strokeStyle = 'rgba(40, 0, 12, 0.55)'
          ctx.lineWidth = 1.3 * S
          for (let i = 0; i < 26; i++) {
            const t = rnd()
            let x = x0 + Math.cos(ang) * len * t + nx * (rnd() - 0.5) * w0 * 2
            let y = y0 + Math.sin(ang) * len * t + ny * (rnd() - 0.5) * w0 * 2
            ctx.beginPath()
            ctx.moveTo(x, y)
            for (let k = 0; k < 5; k++) {
              x += Math.cos(ang + (rnd() - 0.5) * 2.2) * w0 * 0.6
              y += Math.sin(ang + (rnd() - 0.5) * 2.2) * w0 * 0.6
              ctx.lineTo(x, y)
            }
            ctx.stroke()
          }
          ctx.restore()
          // Кромка светится ярче
          ctx.strokeStyle = 'rgba(255, 120, 170, 0.7)'
          ctx.lineWidth = 1.6 * S
          shape()
          ctx.stroke()
          // Гарда — тёмная перекладина у основания
          ctx.save()
          ctx.translate(x0, y0)
          ctx.rotate(ang)
          ctx.fillStyle = '#1a0209'
          ctx.fillRect(-w0 * 0.5, -w0 * 2.1, w0 * 0.9, w0 * 4.2)
          ctx.fillStyle = '#5a0820'
          ctx.fillRect(-w0 * 2.4, -w0 * 0.35, w0 * 2, w0 * 0.7)
          ctx.restore()
        }
        blade(cx - R * 0.42, cy - R * 0.32, cx - R * 1.32, cy + R * 0.55, 24 * S)
        blade(cx + R * 0.42, cy - R * 0.2, cx + R * 1.38, cy + R * 0.42, 22 * S)

        // Лепестки — розовые овалы по всему небу
        for (let i = 0; i < 90; i++) {
          const x = rnd() * W
          const y = rnd() * H
          ctx.save()
          ctx.translate(x, y)
          ctx.rotate(rnd() * Math.PI)
          ctx.globalAlpha = 0.45 + rnd() * 0.5
          ctx.fillStyle = rnd() > 0.3 ? '#f29ac8' : '#ff5c9a'
          ctx.beginPath()
          ctx.ellipse(0, 0, (2 + rnd() * 4) * S, (1 + rnd() * 1.6) * S, 0, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
        ctx.globalAlpha = 1
        // Подпись стиля — едва заметная точечная сетка по небу слева
        dotGrid(16 * S, 1.1 * S, '#9fc3cf', (x) => (x < W * 0.22 ? 0.07 * (1 - x / (W * 0.22)) : 0))
      },

      // Чёрный космос и огромная тёмно-красная планета снизу справа, как в роликах Familiar
      planet() {
        ctx.fillStyle = '#050505'
        ctx.fillRect(0, 0, W, H)
        for (let i = 0; i < 260; i++) {
          ctx.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`
          ctx.fillRect(rnd() * W, rnd() * H * 0.7, 1.5 * S, 1.5 * S)
        }
        const cx = W * 0.78
        const cy = H * 1.55
        const R = H * 1.15
        const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.55, R * 0.1, cx, cy, R)
        body.addColorStop(0, '#7a1414')
        body.addColorStop(0.45, '#3d0909')
        body.addColorStop(1, '#120202')
        ctx.fillStyle = body
        ctx.beginPath()
        ctx.arc(cx, cy, R, 0, Math.PI * 2)
        ctx.fill()
        // Светящийся край атмосферы
        ctx.strokeStyle = 'rgba(255, 70, 60, 0.55)'
        ctx.lineWidth = 3 * S
        ctx.shadowColor = '#ff2d2d'
        ctx.shadowBlur = 40 * S
        ctx.beginPath()
        ctx.arc(cx, cy, R, Math.PI * 1.05, Math.PI * 1.95)
        ctx.stroke()
        ctx.shadowBlur = 0
        // Полутон из точек по поверхности планеты
        dotGrid(14 * S, 1.6 * S, '#ff6a5a', (x, y) => {
          const d = Math.hypot(x - cx, y - cy)
          return d < R ? 0.12 * (1 - d / R) * 3 : 0
        })
      },

      // Сетка погасших точек и большое кольцо из горящих — как «глаз» визуализатора
      grid() {
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, W, H)
        const step = 22 * S
        const cx = W / 2
        const cy = H / 2
        const R = H * 0.3
        dotGrid(step, 2 * S, '#ffffff', (x, y) => {
          const d = Math.abs(Math.hypot(x - cx, y - cy) - R)
          return d < step * 0.9 ? 0.85 : 0.08
        })
        ctx.fillStyle = '#ff2d2d'
        ctx.beginPath()
        ctx.arc(cx + R, cy, 4 * S, 0, Math.PI * 2)
        ctx.fill()
      },

      // Тёмно-красный горизонт с волной из точек
      horizon() {
        const sky = ctx.createLinearGradient(0, 0, 0, H)
        sky.addColorStop(0, '#000')
        sky.addColorStop(0.62, '#120303')
        sky.addColorStop(1, '#3a0707')
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, W, H)
        const step = 12 * S
        for (let x = 0; x < W; x += step) {
          const y0 = H * 0.66 + Math.sin(x / (W / 5)) * H * 0.04 + Math.sin(x / (W / 13)) * H * 0.012
          for (let y = y0; y < H; y += step) {
            const k = 1 - (y - y0) / (H - y0)
            ctx.globalAlpha = 0.15 + k * 0.6
            ctx.fillStyle = y - y0 < step ? '#ff2d2d' : '#ff8070'
            ctx.beginPath()
            ctx.arc(x, y, (y - y0 < step ? 2.2 : 1.3) * S, 0, Math.PI * 2)
            ctx.fill()
          }
        }
        ctx.globalAlpha = 1
      },

      // Для светлой темы: бумага и чёрные точки
      paper() {
        ctx.fillStyle = '#ecebe8'
        ctx.fillRect(0, 0, W, H)
        const cx = W * 0.72
        const cy = H * 0.45
        dotGrid(18 * S, 1.8 * S, '#111', (x, y) => {
          const d = Math.hypot(x - cx, y - cy) / (H * 0.42)
          return d < 1 ? 0.75 * (1 - d) + 0.08 : 0.08
        })
        ctx.fillStyle = '#ff2d2d'
        ctx.beginPath()
        ctx.arc(cx, cy, 9 * S, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ;(styles[style] ?? styles.moon)()
  }

  function render(style, W, H) {
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    draw(canvas.getContext('2d'), style, W, H)
    return canvas.toDataURL('image/png')
  }

  window.Wallpapers = { draw, render }

  const params = new URLSearchParams(location.search)
  window.renderWallpaper = () => render(params.get('style') || 'moon', Number(params.get('w')) || 1920, Number(params.get('h')) || 1080)
})()
