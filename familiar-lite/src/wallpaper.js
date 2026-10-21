// Генератор обоев в стиле Familiar/Nothing. Рисуем под точное разрешение экрана.
;(() => {
  const params = new URLSearchParams(location.search)
  const style = params.get('style') || 'planet'
  const W = Number(params.get('w')) || 1920
  const H = Number(params.get('h')) || 1080
  const S = Math.min(W, H) / 1080 // масштаб относительно Full HD

  // Предсказуемый «случайный» генератор — одинаковые обои при каждом нажатии
  let seed = 42
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

  function dotGrid(ctx, step, r, color, mask = () => 1) {
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
    // Чёрный космос и огромная тёмно-красная планета снизу справа, как в роликах Familiar
    planet(ctx) {
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
      dotGrid(ctx, 14 * S, 1.6 * S, '#ff6a5a', (x, y) => {
        const d = Math.hypot(x - cx, y - cy)
        return d < R ? 0.12 * (1 - d / R) * 3 : 0
      })
    },

    // Сетка погасших точек и большое кольцо из горящих — как «глаз» визуализатора
    grid(ctx) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      const step = 22 * S
      const cx = W / 2
      const cy = H / 2
      const R = H * 0.3
      dotGrid(ctx, step, 2 * S, '#ffffff', (x, y) => {
        const d = Math.abs(Math.hypot(x - cx, y - cy) - R)
        return d < step * 0.9 ? 0.85 : 0.08
      })
      ctx.fillStyle = '#ff2d2d'
      ctx.beginPath()
      ctx.arc(cx + R, cy, 4 * S, 0, Math.PI * 2)
      ctx.fill()
    },

    // Тёмно-красный горизонт с волной из точек
    horizon(ctx) {
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
    paper(ctx) {
      ctx.fillStyle = '#ecebe8'
      ctx.fillRect(0, 0, W, H)
      const cx = W * 0.72
      const cy = H * 0.45
      dotGrid(ctx, 18 * S, 1.8 * S, '#111', (x, y) => {
        const d = Math.hypot(x - cx, y - cy) / (H * 0.42)
        return d < 1 ? 0.75 * (1 - d) + 0.08 : 0.08
      })
      ctx.fillStyle = '#ff2d2d'
      ctx.beginPath()
      ctx.arc(cx, cy, 9 * S, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  window.renderWallpaper = () => {
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    ;(styles[style] ?? styles.planet)(ctx)
    return canvas.toDataURL('image/png')
  }
})()
