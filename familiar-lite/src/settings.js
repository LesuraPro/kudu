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

// Переключатель-«таблетка» из нескольких вариантов
const seg = (options, current, onPick) =>
  el(
    'div',
    { className: 'segmented' },
    options.map(([value, label]) => el('button', { className: current === value ? 'active' : '', textContent: label, onclick: () => onPick(value) }))
  )

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
      // Палитры: полоска цветов — фон, текст, подписи, акцент, второй акцент
      const pals = await f.listPalettes()
      const PALS = {
        moon: ['Луна и клинок', 'ночь, лунный свет, малиновый клинок'],
        nothing: ['Nothing', 'чёрное стекло и красный акцент'],
        wallpaper: ['Из обоев', pals.wallpaper ? 'цвета подобраны по твоим обоям' : 'сначала поставь обои']
      }
      const palTiles = Object.entries(PALS).map(([key, [name, desc]]) => {
        const colors = pals[key] ?? ['#333', '#555', '#777', '#999', '#bbb']
        const strip = el('div', { className: 'strip' }, colors.map((c) => Object.assign(el('i', {}), { style: `background:${c}` })))
        const cls = 'pal' + ((config.palette ?? 'moon') === key ? ' active' : '') + (pals[key] ? '' : ' disabled')
        return el('div', { className: cls, onclick: () => f.setSetting('palette', key) }, strip, el('b', {}, name), el('small', {}, desc))
      })

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
        el('div', { className: 'sub' }, 'Тема, палитра и обои запоминаются для текущего профиля.'),
        el('h2', {}, 'Тема'),
        el('div', { className: 'group' }, row('Цвета интерфейса', 'Остров всегда остаётся тёмным — как вырез в экране', seg)),
        el('h2', {}, 'Палитра'),
        el('div', { className: 'palettes' }, palTiles),
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
          row('Остров', 'Часы, бегущая строка с треком, плеер и таймер фокуса при наведении', toggle(config.island, (on) => f.setSetting('island', on)))
        ),
        el('h2', {}, 'Работа'),
        el(
          'div',
          { className: 'group' },
          row('Эко-режим', 'Вдвое меньше кадров во всех виджетах — компьютер отдыхает. Само включается от батареи и через 3 минуты без мыши', toggle(!!config.eco, (on) => f.setSetting('eco', on))),
          row('Запускать вместе с Windows', 'Оболочка появится сама после входа в систему', toggle(await f.getAutostart(), (on) => f.setSetting('autostart', on))),
          row('Поиск в интернете', 'Последняя строка в Alt+Space, или начни запрос с «?»', seg([['yandex', 'Яндекс'], ['google', 'Google']], config.searchEngine ?? 'yandex', (v) => f.setSetting('searchEngine', v)))
        )
      ]
    }
  },

  schedule: {
    title: 'Расписание',
    async render() {
      const DAYS = [[1, 'Понедельник'], [2, 'Вторник'], [3, 'Среда'], [4, 'Четверг'], [5, 'Пятница'], [6, 'Суббота']]
      // Обычные времена пар; новая пара занимает следующий свободный слот
      const SLOTS = [['08:30', '10:00'], ['10:10', '11:40'], ['12:20', '13:50'], ['14:00', '15:30'], ['15:40', '17:10'], ['17:20', '18:50']]
      let data = (await f.widgetData('schedule')) ?? { days: {} }
      data.days ??= {}
      let timer
      const save = (rerender = false) => {
        clearTimeout(timer)
        timer = setTimeout(() => f.setWidgetData('schedule', data), 300)
        if (rerender) show('schedule', { quiet: true })
      }

      // Какая неделя сейчас — считается от понедельника «первой недели» (числитель)
      const monday = (d) => {
        const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
        x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
        return x
      }
      const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const parityNow = () => {
        const [y, m, d] = String(data.weekStart ?? '').split('-').map(Number)
        const now = new Date()
        const start = y ? new Date(y, m - 1, d) : new Date(now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1, 8, 1)
        const weeks = Math.round((monday(now) - monday(start)) / (7 * 86400000))
        return ((weeks % 2) + 2) % 2 === 0 ? 'odd' : 'even'
      }
      const setParity = (p) => {
        const m = monday(new Date())
        if (p === 'even') m.setDate(m.getDate() - 7)
        data.weekStart = iso(m)
        save(true)
      }

      const input = (value, placeholder, onInput, type = 'text', width) => {
        const i = el('input', { type, value: value ?? '', placeholder })
        if (width) i.style.width = width
        i.addEventListener('input', () => onInput(i.value))
        return i
      }
      const select = (options, value, onChange) => {
        const sel = el('select', {}, options.map(([v, label]) => el('option', { value: v, textContent: label, selected: v === value })))
        sel.addEventListener('change', () => onChange(sel.value))
        return sel
      }

      const pairRow = (day, pair, i) =>
        el(
          'div',
          { className: 'row pair-edit' },
          input(pair.start, '08:30', (v) => ((pair.start = v), save()), 'time'),
          input(pair.end, '10:00', (v) => ((pair.end = v), save()), 'time'),
          input(pair.name, 'Предмет', (v) => ((pair.name = v), save())),
          input(pair.room, 'Ауд.', (v) => ((pair.room = v), save()), 'text', '64px'),
          select([['', '—'], ['лек', 'лекция'], ['пр', 'практика'], ['лаб', 'лабораторная'], ['сем', 'семинар']], pair.type ?? '', (v) => ((pair.type = v), save())),
          select([['all', 'каждую'], ['odd', 'числитель'], ['even', 'знаменатель']], pair.week ?? 'all', (v) => ((pair.week = v), save())),
          el('button', { className: 'btn danger', textContent: '✕', title: 'Удалить пару', onclick: () => (data.days[day].splice(i, 1), save(true)) })
        )

      const sample = () => {
        // Пример: можно поправить под себя
        const p = (start, name, type, room, week = 'all') => ({ start, end: SLOTS.find((x) => x[0] === start)[1], name, type, room, week })
        data.days = {
          1: [p('08:30', 'Теория электрических цепей', 'лек', '214'), p('10:10', 'САПР', 'лаб', '305', 'odd'), p('10:10', 'Физика', 'лаб', '118', 'even'), p('12:20', 'Правовые основы УИС', 'сем', '402')],
          2: [p('08:30', 'Радиотехника', 'лек', '214'), p('10:10', 'Дифференциальные уравнения', 'пр', '310'), p('12:20', 'Английский язык', 'пр', '207')],
          3: [p('08:30', 'Физика', 'лек', '101'), p('10:10', 'Теория электрических цепей', 'пр', '214'), p('12:20', 'Физическая подготовка', 'пр', 'спортзал')],
          4: [p('08:30', 'САПР', 'лек', '305'), p('10:10', 'Радиотехника', 'лаб', '216', 'odd'), p('12:20', 'Дифференциальные уравнения', 'лек', '101')],
          5: [p('08:30', 'Правовые основы УИС', 'лек', '402'), p('10:10', 'Программирование на Python', 'лаб', '305'), p('12:20', 'Специальная связь', 'лек', '214', 'even')]
        }
        save(true)
      }

      return [
        el('h1', {}, 'Расписание пар'),
        el('div', { className: 'sub' }, 'Виджет «Расписание пар» показывает сегодняшние пары: текущую — со временем до конца, следующую — через сколько начнётся. После последней пары — расписание на завтра.'),
        el(
          'div',
          { className: 'group' },
          row('Сейчас неделя', 'Числитель и знаменатель чередуются; выбери, какая идёт сейчас', seg([['odd', 'Числитель'], ['even', 'Знаменатель']], parityNow(), setParity)),
          row('Быстрый старт', 'Заполнить примером — потом поправишь под себя', el('button', { className: 'btn', textContent: 'Вставить пример', onclick: sample }), el('button', { className: 'btn danger', textContent: 'Очистить', onclick: () => ((data.days = {}), save(true)) }))
        ),
        ...DAYS.flatMap(([day, name]) => {
          const pairs = (data.days[day] ??= [])
          return [
            el('h2', {}, name),
            el(
              'div',
              { className: 'group' },
              pairs.map((p, i) => pairRow(day, p, i)),
              el(
                'div',
                { className: 'row' },
                el('button', {
                  className: 'btn',
                  textContent: '+ пара',
                  onclick: () => {
                    const slot = SLOTS[Math.min(pairs.length, SLOTS.length - 1)]
                    pairs.push({ start: slot[0], end: slot[1], name: '', room: '', type: '', week: 'all' })
                    save(true)
                  }
                })
              )
            )
          ]
        })
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
          'Картинки (10 форматов), PDF ↔ Word, пароль на PDF, окна обрезки, правки, пометок и других инструментов; можно и через ПКМ → «Отправить» → «Familiar — преобразовать» или «Преобразовать…» в «Файлах».'
        ),
        el(
          'div',
          { className: 'group' },
          row('Включён', 'Shift во время перетаскивания файла из любой программы. В игре на весь экран не мешает', toggle(d.enabled, (on) => set({ enabled: on }))),
          row('Клавиша', 'Нажать, пока тащишь файл', seg([['shift', 'Shift'], ['ctrl', 'Ctrl'], ['alt', 'Alt']], d.key, (v) => set({ key: v }))),
          row('Куда сохранять', null, seg([['beside', 'Рядом'], ['folder', 'В «Преобразовано»']], d.output, (v) => set({ output: v }))),
          row('Пункт в «Отправить»', 'ПКМ по файлу → Отправить → Familiar — преобразовать', toggle(d.sendTo, (on) => set({ sendTo: on })))
        ),
        el('h2', {}, 'Качество'),
        el(
          'div',
          { className: 'group' },
          row('JPG и WebP', 'Для смены формата и как начальное качество в окне «Сжать»', seg([[0.7, 'Меньше'], [0.82, 'Баланс'], [0.92, 'Лучше']], d.quality, (v) => set({ quality: v }))),
          row('«До размера»', 'Цель по умолчанию в окне «Сжать» — например, для сайтов с лимитом', seg([[200, '200 КБ'], [500, '500 КБ'], [1024, '1 МБ'], [2048, '2 МБ']], d.targetKb, (v) => set({ targetKb: v }))),
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
        ['Ctrl + Alt + Пробел', 'Музыка: пауза / играть — из любой программы'],
        ['Ctrl + Alt + ← →', 'Музыка: предыдущий / следующий трек'],
        ['Alt + Space, «2+2*3»', 'Калькулятор; «10 км в мили» — перевод единиц; Enter копирует ответ'],
        ['Alt + Space, «фокус 25»', 'Таймер фокуса в острове; ещё «перерыв», «таймер 10», «стоп»'],
        ['Alt + Space, «сон», «блок»…', 'Команды: сон, блокировка, выключить через N минут, корзина, эко, тема'],
        ['Alt + Space, «? запрос»', 'Сразу искать в интернете (Яндекс или Google — в «Панель и остров»)'],
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
  schedule: ['#####', '#...#', '#####', '#.#.#', '#####'],
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
