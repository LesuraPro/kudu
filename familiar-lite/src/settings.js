// Окно настроек. Каждый раздел — функция, которая собирает страницу заново
// из актуального config (при любом изменении настроек страница перерисовывается).
const f = window.familiar
const main = document.getElementById('main')
const nav = document.getElementById('nav')

// Маленький помощник: el('div', { className, onclick, ... }, ...дети)
function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props)
  e.append(...children.flat().filter((c) => c != null && c !== false))
  return e
}

const row = (title, hint, ...controls) => el('div', { className: 'row' }, el('div', { className: 'grow' }, title, hint && el('small', {}, hint)), ...controls)

function toggle(on, onChange) {
  const s = el('button', { className: 'switch' + (on ? ' on' : '') })
  s.addEventListener('click', () => {
    s.classList.toggle('on')
    onChange(s.classList.contains('on'))
  })
  return s
}

function avatar(profile, size) {
  const a = el('div', { className: `avatar ${size}` })
  if (profile.photo) a.style.backgroundImage = `url("${profile.photo}")`
  else a.textContent = (profile.name || '?').charAt(0).toUpperCase()
  return a
}

let config = null

// Превью обоев — те же обои, что поставятся на экран, только уменьшенные.
// Рисуем один раз: страница перерисовывается часто
const previews = new Map()
function preview(style) {
  if (!previews.has(style)) {
    const c = document.createElement('canvas')
    c.width = 384
    c.height = 216
    const ctx = c.getContext('2d')
    ctx.scale(384 / 1920, 216 / 1080)
    Wallpapers.draw(ctx, style, 1920, 1080)
    previews.set(style, c.toDataURL())
  }
  return previews.get(style)
}

// ---------- Разделы ----------

const pages = {
  profile: {
    title: 'Профиль',
    async render() {
      const list = await f.listProfiles()
      const me = list.find((p) => p.current)
      const big = avatar(me, 'big')
      big.title = 'Выбрать фото'
      big.addEventListener('click', () => f.chooseProfilePhoto(me.id))
      const name = el('input', { type: 'text', value: me.name, placeholder: 'Как тебя зовут?' })
      const saveName = () => name.value.trim() && name.value.trim() !== me.name && f.renameProfile(me.id, name.value)
      name.addEventListener('change', saveName)
      name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur())

      const others = list.map((p) =>
        row(
          el('span', {}, p.name, ' ', p.current ? el('span', { className: 'badge' }, '· текущий') : null),
          null,
          avatar(p, 'small'),
          !p.current && el('button', { className: 'btn', textContent: 'Переключить', onclick: () => f.switchProfile(p.id) }),
          !p.current &&
            el('button', {
              className: 'btn danger',
              textContent: 'Удалить',
              onclick: () => confirm(`Удалить профиль «${p.name}»? Его закреплённые приложения и раскладка виджетов пропадут.`) && f.removeProfile(p.id)
            })
        )
      )
      // Аватар — слева от имени
      others.forEach((r) => r.prepend(r.querySelector('.avatar')))

      const newName = el('input', { type: 'text', placeholder: 'Например, «Учёба» или «Игры»' })
      const create = async () => {
        if (!newName.value.trim()) return newName.focus()
        const id = await f.createProfile(newName.value)
        newName.value = ''
        if (confirm('Профиль создан. Переключиться на него сейчас?')) f.switchProfile(id)
      }
      newName.addEventListener('keydown', (e) => e.key === 'Enter' && create())

      return [
        el('h1', {}, 'Профиль'),
        el('div', { className: 'sub' }, 'У каждого профиля свои закреплённые приложения, набор и расположение виджетов, тема и обои. Всё хранится только на этом компьютере.'),
        el(
          'div',
          { className: 'group' },
          el(
            'div',
            { className: 'row' },
            big,
            el(
              'div',
              { className: 'grow' },
              name,
              el(
                'div',
                { style: 'display:flex; gap:8px; margin-top:10px' },
                el('button', { className: 'btn', textContent: 'Выбрать фото', onclick: () => f.chooseProfilePhoto(me.id) }),
                me.photo && el('button', { className: 'btn', textContent: 'Убрать фото', onclick: () => f.clearProfilePhoto(me.id) })
              )
            )
          )
        ),
        el('h2', {}, 'Все профили'),
        el('div', { className: 'group' }, others),
        el('h2', {}, 'Новый профиль'),
        el('div', { className: 'group' }, el('div', { className: 'row' }, el('div', { className: 'grow' }, newName), el('button', { className: 'btn primary', textContent: 'Создать', onclick: create }))),
        el('div', { className: 'sub', style: 'margin-top:10px' }, 'Новый профиль начинается копией текущего — потом настрой его как хочешь.')
      ]
    }
  },

  appearance: {
    title: 'Оформление',
    async render() {
      const themes = { system: 'Как в системе', light: 'Светлая', dark: 'Тёмная' }
      const seg = el(
        'div',
        { className: 'segmented' },
        Object.entries(themes).map(([k, label]) =>
          el('button', { className: config.theme === k ? 'active' : '', textContent: label, onclick: () => f.setSetting('theme', k) })
        )
      )

      const status = el('div', { id: 'wallStatus' })
      const apply = async (value, label) => {
        status.textContent = `Ставлю «${label}»…`
        try {
          await (value ? f.applyWallpaper(value) : f.chooseWallpaper())
          status.textContent = 'Готово'
        } catch (e) {
          status.textContent = `Не получилось: ${e.message}`
        }
      }
      const styles = await f.listWallpapers()
      const tiles = Object.entries(styles).map(([style, label]) => {
        const img = el('img', { src: preview(style) })
        img.style.cssText = 'display:block; width:100%; aspect-ratio:16/9'
        return el('div', { className: 'wall' + (config.wallpaper === style ? ' active' : ''), onclick: () => apply(style, label) }, img, el('span', {}, label))
      })
      const custom = config.wallpaper?.startsWith('custom:')
      tiles.push(el('div', { className: 'wall' + (custom ? ' active' : ''), onclick: () => apply(null, 'своя картинка') }, el('div', { className: 'custom' }, '+'), el('span', {}, custom ? 'Своя картинка ✓' : 'Своя картинка…')))

      return [
        el('h1', {}, 'Оформление'),
        el('div', { className: 'sub' }, 'Тема и обои запоминаются для текущего профиля.'),
        el('h2', {}, 'Тема'),
        el('div', { className: 'group' }, row('Цвета интерфейса', 'Остров всегда остаётся чёрным — как вырез в экране', seg)),
        el('h2', {}, 'Обои'),
        el('div', { className: 'walls' }, tiles),
        status
      ]
    }
  },

  widgets: {
    title: 'Виджеты',
    async render() {
      const list = await f.listWidgets()
      return [
        el('h1', {}, 'Виджеты'),
        el('div', { className: 'sub' }, 'Каждый виджет — отдельное окно: таскай мышкой, место запоминается. Alt+W — показать или скрыть все.'),
        el('div', { className: 'group' }, list.map((w) => row(w.title, w.custom ? 'свой виджет из папки виджетов' : null, toggle(w.enabled, (on) => f.setWidget(w.name, on))))),
        el('h2', {}, 'Ещё'),
        el(
          'div',
          { className: 'group' },
          row('Раскладка по умолчанию', 'Вернуть все виджеты на свои места справа', el('button', { className: 'btn', textContent: 'Вернуть', onclick: () => f.resetLayout() })),
          row('Свои виджеты', 'Любой .js в этой папке станет виджетом — пример: pomodoro.js', el('button', { className: 'btn', textContent: 'Открыть папку', onclick: () => f.openWidgetsFolder() }))
        )
      ]
    }
  },

  panel: {
    title: 'Панель и остров',
    async render() {
      return [
        el('h1', {}, 'Панель и остров'),
        el('div', { className: 'sub' }, 'Верхняя панель как в macOS и «остров» с музыкой в её центре.'),
        el(
          'div',
          { className: 'group' },
          row('Верхняя панель', 'На Windows занимает полосу экрана — развёрнутые окна не заезжают под неё', toggle(config.menubar, (on) => f.setSetting('menubar', on))),
          row('Остров', 'Часы, бегущая строка с треком и плеер при наведении', toggle(config.island, (on) => f.setSetting('island', on)))
        )
      ]
    }
  },

  weather: {
    title: 'Погода',
    async render() {
      const results = el('div', { className: 'group results', hidden: true })
      const q = el('input', { type: 'text', placeholder: 'Начни вводить город…' })
      let timer
      q.addEventListener('input', () => {
        clearTimeout(timer)
        timer = setTimeout(async () => {
          const text = q.value.trim()
          if (text.length < 2) return (results.hidden = true)
          try {
            const found = await f.searchCity(text)
            results.replaceChildren(
              ...(found.length
                ? found.map((c) =>
                    el('button', { onclick: () => f.setSetting('weather', { city: c.city, latitude: c.latitude, longitude: c.longitude }) }, c.city, el('small', {}, c.region))
                  )
                : [el('div', { className: 'row' }, 'Ничего не нашлось')])
            )
          } catch {
            results.replaceChildren(el('div', { className: 'row' }, 'Нет связи с сервером'))
          }
          results.hidden = false
        }, 350)
      })
      const w = config.weather
      return [
        el('h1', {}, 'Погода'),
        el('div', { className: 'sub' }, 'Данные Open-Meteo — бесплатно и без регистрации.'),
        el('div', { className: 'group' }, row(w.city, `${w.latitude.toFixed(2)}, ${w.longitude.toFixed(2)}`, el('span', { className: 'badge' }, 'сейчас'))),
        el('h2', {}, 'Сменить город'),
        q,
        el('div', { style: 'height:10px' }),
        results
      ]
    }
  },

  dragshift: {
    title: 'Конвертер',
    async render() {
      const d = config.dragshift
      const set = (patch) => f.setSetting('dragshift', patch)
      const seg = (options, current, onPick) =>
        el(
          'div',
          { className: 'segmented' },
          options.map(([value, label]) => el('button', { className: current === value ? 'active' : '', textContent: label, onclick: () => onPick(value) }))
        )
      return [
        el('h1', {}, 'Конвертер'),
        el(
          'div',
          { className: 'sub' },
          'Начни тащить файл, нажми Shift — под курсором появится круговое меню. Отпусти файл на секторе — результат появится рядом, оригинал не трогается. Ещё раз Shift — другие действия. ',
          'Картинки, PDF, Word и текст; можно и через ПКМ → «Отправить» → «Familiar — преобразовать» или «Преобразовать…» в «Файлах».'
        ),
        el(
          'div',
          { className: 'group' },
          row('Включён', 'Shift во время перетаскивания из Проводника, с рабочего стола и из «Файлов»', toggle(d.enabled, (on) => set({ enabled: on }))),
          row('Клавиша', 'Нажать, пока тащишь файл', seg([['shift', 'Shift'], ['ctrl', 'Ctrl'], ['alt', 'Alt']], d.key, (v) => set({ key: v }))),
          row('Куда сохранять', null, seg([['beside', 'Рядом'], ['folder', 'В «Преобразовано»']], d.output, (v) => set({ output: v }))),
          row('Пункт в «Отправить»', 'ПКМ по файлу → Отправить → Familiar — преобразовать', toggle(d.sendTo, (on) => set({ sendTo: on })))
        ),
        el('h2', {}, 'Качество'),
        el(
          'div',
          { className: 'group' },
          row('JPG и WebP', 'Для «Сжать» и смены формата', seg([[0.7, 'Меньше'], [0.82, 'Баланс'], [0.92, 'Лучше']], d.quality, (v) => set({ quality: v }))),
          row('«≤ размер»', 'До скольких сжимать, например для сайтов с лимитом', seg([[200, '200 КБ'], [500, '500 КБ'], [1024, '1 МБ'], [2048, '2 МБ']], d.targetKb, (v) => set({ targetKb: v }))),
          row('PDF → картинки', 'Чётче — больше файлы', seg([[96, '96 dpi'], [150, '150'], [300, '300']], d.dpi, (v) => set({ dpi: v })))
        ),
        el(
          'div',
          { className: 'sub', style: 'margin-top:14px' },
          'По мотивам DragShift — github.com/llamaboi55/DragShift (лицензия MIT). Код здесь свой, на JavaScript, а форматы и жест — оттуда.'
        )
      ]
    }
  },

  windows: {
    title: 'Система Windows',
    async render() {
      // Тонкие системные настройки Familiar не трогает — открываем их прямо в Windows
      const links = [
        ['Дисплей и масштаб', 'ms-settings:display'],
        ['Звук', 'ms-settings:sound'],
        ['Bluetooth и устройства', 'ms-settings:bluetooth'],
        ['Персонализация', 'ms-settings:personalization'],
        ['Панель задач', 'ms-settings:taskbar'],
        ['Автозагрузка', 'ms-settings:startupapps'],
        ['Приложения по умолчанию', 'ms-settings:defaultapps'],
        ['Питание', 'ms-settings:powersleep']
      ]
      return [
        el('h1', {}, 'Система Windows'),
        el('div', { className: 'sub' }, 'Системные настройки открываются в «Параметрах» Windows.'),
        el('div', { className: 'group' }, links.map(([label, uri]) => row(label, null, el('button', { className: 'btn', textContent: 'Открыть ↗', onclick: () => f.launch({ path: uri }) }))))
      ]
    }
  },

  keys: {
    title: 'Клавиши',
    async render() {
      const keys = [
        ['Alt + Space', 'Поиск приложений, игр и файлов'],
        ['Alt + W', 'Показать или скрыть виджеты'],
        ['Ctrl + Alt + Q', 'Выйти из Familiar Lite (программы Windows продолжат работать)'],
        ['Shift при перетаскивании', 'Конвертер: круговое меню под курсором; ещё раз Shift — другие действия'],
        ['Ctrl + Enter', 'В поиске — закрепить найденное в доке'],
        ['1 – 5', 'В терминале familiar-tty — сцены'],
        ['Backspace, Alt + ← →', 'В «Файлах» — вверх, назад, вперёд']
      ]
      return [el('h1', {}, 'Клавиши'), el('div', { className: 'sub' }, ' '), el('div', { className: 'group' }, keys.map(([k, what]) => row(what, null, el('kbd', {}, k))))]
    }
  },

  about: {
    title: 'О программе',
    async render() {
      return [
        el('h1', {}, 'Familiar Lite'),
        el(
          'div',
          { className: 'sub' },
          'Бесплатная самописная оболочка в стиле Familiar Desktop. Не связана ни с Familiar, ни с Apple, ни с Microsoft. Код открыт: main.js, lib/ и src/ — заглядывай и меняй.'
        ),
        el(
          'div',
          { className: 'group' },
          row('Папка Familiar', 'Ярлыки и файлы, которые видно в виджете «Ярлыки» и в поиске', el('button', { className: 'btn', textContent: 'Открыть', onclick: () => f.openFiles() })),
          row('Выйти', 'Ctrl + Alt + Q', el('button', { className: 'btn danger', textContent: 'Выйти', onclick: () => f.quit() }))
        )
      ]
    }
  }
}

// ---------- Навигация ----------

// Иконки разделов 5×5 точек — в том же стиле, что и всё остальное
const ICONS = {
  profile: ['.###.', '.###.', '.....', '#####', '#####'],
  appearance: ['.###.', '##..#', '##..#', '##..#', '.###.'],
  widgets: ['##.##', '##.##', '.....', '##.##', '##.##'],
  panel: ['#####', '.....', '.###.', '.....', '.....'],
  weather: ['#.#.#', '.###.', '#####', '.###.', '#.#.#'],
  windows: ['#####', '#.#.#', '#####', '#.#.#', '#####'],
  dragshift: ['..#..', '.#.#.', '#...#', '.#.#.', '..#..'],
  keys: ['#####', '#.#.#', '#####', '.###.', '.....'],
  about: ['..#..', '.....', '..#..', '..#..', '..#..']
}

function dotIcon(rows) {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 5 5')
  svg.setAttribute('class', 'icon')
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      const dot = document.createElementNS(ns, 'circle')
      dot.setAttribute('cx', x + 0.5)
      dot.setAttribute('cy', y + 0.5)
      dot.setAttribute('r', c === '#' ? 0.38 : 0.16)
      dot.setAttribute('opacity', c === '#' ? 1 : 0.25)
      svg.appendChild(dot)
    })
  )
  return svg
}

let page = new URLSearchParams(location.search).get('page') || 'profile'

for (const [key, p] of Object.entries(pages)) {
  nav.append(el('button', { onclick: () => show(key) }, dotIcon(ICONS[key]), p.title))
}

async function show(key, { quiet = false } = {}) {
  if (!pages[key]) key = 'profile'
  page = key
  ;[...nav.children].forEach((b, i) => b.classList.toggle('active', Object.keys(pages)[i] === key))
  const content = await pages[key].render()
  const wrap = el('div', { className: quiet ? '' : 'page' }, content)
  main.replaceChildren(wrap)
  if (!quiet) main.scrollTop = 0
}

f.onSettingsPage((key) => show(key))
f.onConfigChanged((c) => {
  config = c
  // Пока что-то печатают — не перерисовываем, чтобы не сбить ввод
  if (document.activeElement?.tagName !== 'INPUT') {
    const scroll = main.scrollTop
    show(page, { quiet: true }).then(() => (main.scrollTop = scroll))
  }
})

f.getConfig().then((c) => {
  config = c
  show(page)
})
