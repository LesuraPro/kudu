// Быстрые ответы в поиске (Alt+Space): калькулятор, перевод единиц, команды и поиск в интернете.
// Quick.answers(запрос) → список особых строк для выдачи. Каждая строка — { name, kind, action },
// action выполняет главный процесс (window.familiar.quickAction). Ничего не вычисляется через eval:
// выражение разбирается своим маленьким парсером, поэтому в поиск нельзя «подсунуть» код.
;(() => {
  // ---------- Калькулятор ----------

  const FUNCS = {
    sqrt: Math.sqrt, корень: Math.sqrt, abs: Math.abs, модуль: Math.abs,
    sin: (x) => Math.sin((x * Math.PI) / 180), cos: (x) => Math.cos((x * Math.PI) / 180), tan: (x) => Math.tan((x * Math.PI) / 180),
    tg: (x) => Math.tan((x * Math.PI) / 180), ln: Math.log, log: Math.log10, lg: Math.log10, exp: Math.exp, round: Math.round
  }
  const CONSTS = { pi: Math.PI, пи: Math.PI, e: Math.E }
  // Унарный минус слабее степени (−3² = −9), но сильнее умножения
  const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, 'u-': 2.5, '^': 3 }

  function tokenize(src) {
    const out = []
    let i = 0
    while (i < src.length) {
      const c = src[i]
      if (/\s/.test(c)) {
        i++
        continue
      }
      const num = src.slice(i).match(/^\d+(?:[.,]\d+)?(?:e[+-]?\d+)?/i)
      if (num) {
        out.push({ t: 'num', v: parseFloat(num[0].replace(',', '.')) })
        i += num[0].length
        continue
      }
      const word = src.slice(i).match(/^[a-zа-яё]+/i)
      if (word) {
        const w = word[0].toLowerCase()
        if (FUNCS[w]) out.push({ t: 'fn', v: w })
        else if (w in CONSTS) out.push({ t: 'num', v: CONSTS[w] })
        else throw new Error('неизвестное слово')
        i += w.length
        continue
      }
      if (c === '√') out.push({ t: 'fn', v: 'sqrt' })
      else if ('+-*/^()%'.includes(c)) out.push({ t: 'op', v: c })
      else if (c === '×' || c === '·') out.push({ t: 'op', v: '*' })
      else if (c === '÷' || c === ':') out.push({ t: 'op', v: '/' })
      else throw new Error('лишний знак')
      i++
    }
    return out
  }

  // Сортировочная станция Дейкстры: инфиксная запись → обратная польская, потом считаем
  function evaluate(src) {
    const tokens = tokenize(src)
    const output = []
    const ops = []
    let prev = null // что было перед текущим: для унарного минуса
    for (const tk of tokens) {
      if (tk.t === 'num') output.push(tk)
      else if (tk.t === 'fn') ops.push(tk)
      else if (tk.v === '(') ops.push(tk)
      else if (tk.v === ')') {
        while (ops.length && ops.at(-1).v !== '(') output.push(ops.pop())
        if (!ops.length) throw new Error('скобки')
        ops.pop()
        if (ops.at(-1)?.t === 'fn') output.push(ops.pop())
      } else if (tk.v === '%') output.push({ t: 'op', v: '%' }) // постфиксный: 15% = 0.15
      else {
        let op = tk.v
        if (op === '-' && (!prev || (prev.t === 'op' && prev.v !== ')' && prev.v !== '%') || prev.t === 'fn')) op = 'u-'
        else if (op === '+' && (!prev || (prev.t === 'op' && prev.v !== ')' && prev.v !== '%'))) {
          prev = tk
          continue
        }
        // Минус перед числом — приставка: ничего из стека не выталкивает
        while (op !== 'u-' && ops.length) {
          const top = ops.at(-1)
          if (top.t === 'fn') output.push(ops.pop())
          else if (top.v !== '(' && (PREC[top.v] > PREC[op] || (PREC[top.v] === PREC[op] && op !== '^'))) output.push(ops.pop())
          else break
        }
        ops.push({ t: 'op', v: op })
      }
      prev = tk
    }
    while (ops.length) {
      const op = ops.pop()
      if (op.v === '(') throw new Error('скобки')
      output.push(op)
    }
    const st = []
    for (const tk of output) {
      if (tk.t === 'num') st.push(tk.v)
      else if (tk.t === 'fn') st.push(FUNCS[tk.v](st.pop()))
      else if (tk.v === 'u-') st.push(-st.pop())
      else if (tk.v === '%') st.push(st.pop() / 100)
      else {
        const b = st.pop()
        const a = st.pop()
        if (a === undefined || b === undefined) throw new Error('не хватает чисел')
        st.push(tk.v === '+' ? a + b : tk.v === '-' ? a - b : tk.v === '*' ? a * b : tk.v === '/' ? a / b : Math.pow(a, b))
      }
    }
    if (st.length !== 1 || !Number.isFinite(st[0])) throw new Error('не считается')
    return st[0]
  }

  // 3.14159265 → «3,1415927»; большие — с пробелами между тысячами
  function fmt(x) {
    if (Number.isInteger(x) && Math.abs(x) < 1e15) return x.toLocaleString('ru-RU').replace(/ /g, ' ')
    const s = Number(x.toPrecision(10)).toString()
    return s.includes('e') ? s : Number(s).toLocaleString('ru-RU', { maximumFractionDigits: 8 }).replace(/ /g, ' ')
  }

  function calc(query) {
    // «20% от 1500» → 0.2*1500
    let src = query.replace(/(\d+(?:[.,]\d+)?)\s*%\s*от\s*/gi, '($1/100)*')
    // Считаем только то, что похоже на выражение: есть цифра и знак действия или функция
    if (!/\d/.test(src) || !/[+\-*/^%×÷:√(]|sqrt|корень|sin|cos|tan|tg|ln|log|lg/i.test(src)) return null
    if (/^\s*-?\d+(?:[.,]\d+)?\s*$/.test(src)) return null
    try {
      const v = evaluate(src)
      const text = fmt(v)
      return { name: `= ${text}`, kind: 'Калькулятор · Enter — скопировать', action: { type: 'copy', text: text.replace(/ /g, '') }, icon: 'calc' }
    } catch {
      return null
    }
  }

  // ---------- Единицы ----------

  const UNITS = {
    // длина, в метрах
    мм: ['len', 0.001], см: ['len', 0.01], дм: ['len', 0.1], м: ['len', 1], км: ['len', 1000],
    mm: ['len', 0.001], cm: ['len', 0.01], m: ['len', 1], km: ['len', 1000],
    дюйм: ['len', 0.0254], дюйма: ['len', 0.0254], дюймов: ['len', 0.0254], in: ['len', 0.0254], inch: ['len', 0.0254],
    фут: ['len', 0.3048], фута: ['len', 0.3048], футов: ['len', 0.3048], ft: ['len', 0.3048],
    миля: ['len', 1609.344], мили: ['len', 1609.344], миль: ['len', 1609.344], mi: ['len', 1609.344],
    // масса, в граммах
    мг: ['mass', 0.001], г: ['mass', 1], кг: ['mass', 1000], т: ['mass', 1e6], g: ['mass', 1], kg: ['mass', 1000],
    фунт: ['mass', 453.592], фунта: ['mass', 453.592], фунтов: ['mass', 453.592], lb: ['mass', 453.592], унция: ['mass', 28.3495], oz: ['mass', 28.3495],
    // данные, в байтах
    б: ['data', 1], кб: ['data', 1024], мб: ['data', 1024 ** 2], гб: ['data', 1024 ** 3], тб: ['data', 1024 ** 4],
    kb: ['data', 1024], mb: ['data', 1024 ** 2], gb: ['data', 1024 ** 3], tb: ['data', 1024 ** 4],
    бит: ['data', 1 / 8], кбит: ['data', 128], мбит: ['data', 131072],
    // время, в секундах
    с: ['time', 1], сек: ['time', 1], мин: ['time', 60], ч: ['time', 3600], час: ['time', 3600], часа: ['time', 3600], часов: ['time', 3600],
    сут: ['time', 86400], дн: ['time', 86400], дня: ['time', 86400], дней: ['time', 86400], нед: ['time', 604800],
    // скорость, в м/с
    'км/ч': ['speed', 1 / 3.6], 'м/с': ['speed', 1], 'mph': ['speed', 0.44704],
    // температура — отдельно
    c: ['temp', 'c'], '°c': ['temp', 'c'], цельсий: ['temp', 'c'], f: ['temp', 'f'], '°f': ['temp', 'f'], фаренгейт: ['temp', 'f'], k: ['temp', 'k'], кельвин: ['temp', 'k']
  }

  function toC(v, u) {
    return u === 'c' ? v : u === 'f' ? ((v - 32) * 5) / 9 : v - 273.15
  }
  function fromC(v, u) {
    return u === 'c' ? v : u === 'f' ? (v * 9) / 5 + 32 : v + 273.15
  }

  function units(query) {
    const m = query.toLowerCase().match(/^\s*(-?\d+(?:[.,]\d+)?)\s*([a-zа-яё°/]+)\s+(?:в|во|to|in)\s+([a-zа-яё°/]+)\s*$/i)
    if (!m) return null
    const v = parseFloat(m[1].replace(',', '.'))
    const a = UNITS[m[2]]
    const b = UNITS[m[3]]
    if (!a || !b || a[0] !== b[0]) return null
    const r = a[0] === 'temp' ? fromC(toC(v, a[1]), b[1]) : (v * a[1]) / b[1]
    const text = fmt(r)
    return { name: `${m[1]} ${m[2]} = ${text} ${m[3]}`, kind: 'Единицы · Enter — скопировать', action: { type: 'copy', text: text.replace(/ /g, '') }, icon: 'calc' }
  }

  // ---------- Команды ----------
  // words — целые слова-ключи. Запрос подходит, если он — начало ключа («засып» → «заснуть»)
  // или ключ и дальше пробел/число («выключить через 30»). «Блокнот» поэтому не станет «блокировкой»

  const COMMANDS = [
    { words: ['фокус', 'помодоро', 'pomodoro', 'учёба', 'учеба', 'учиться'], name: (n) => `Фокус ${n ?? 25} минут`, kind: 'Таймер в острове', action: (n) => ({ type: 'focus', minutes: n ?? 25, label: 'Фокус' }) },
    { words: ['таймер', 'timer'], name: (n) => `Таймер на ${n ?? 10} минут`, kind: 'Таймер в острове', action: (n) => ({ type: 'focus', minutes: n ?? 10, label: 'Таймер' }) },
    { words: ['перерыв', 'отдых', 'отдохнуть', 'break'], name: (n) => `Перерыв ${n ?? 5} минут`, kind: 'Таймер в острове', action: (n) => ({ type: 'focus', minutes: n ?? 5, label: 'Перерыв' }) },
    { words: ['стоп', 'стоп таймер', 'остановить таймер', 'сбросить таймер'], name: () => 'Остановить таймер', kind: 'Таймер', action: () => ({ type: 'focus-stop' }) },
    { words: ['эко', 'эко-режим', 'экономия', 'eco'], name: () => 'Эко-режим: включить или выключить', kind: 'Меньше нагрузки на компьютер', action: () => ({ type: 'eco' }) },
    { words: ['тема', 'тёмная тема', 'темная тема', 'светлая тема', 'theme'], name: () => 'Сменить тему: светлая ↔ тёмная', kind: 'Оформление', action: () => ({ type: 'theme' }) },
    { words: ['пауза', 'играть', 'play', 'музыка'], name: () => 'Музыка: пауза / играть', kind: 'Ctrl+Alt+Пробел', action: () => ({ type: 'media', cmd: 'toggle' }) },
    { words: ['дальше', 'следующий трек', 'следующая', 'next'], name: () => 'Музыка: следующий трек', kind: 'Ctrl+Alt+→', action: () => ({ type: 'media', cmd: 'next' }) },
    { words: ['предыдущий трек', 'предыдущая', 'prev'], name: () => 'Музыка: предыдущий трек', kind: 'Ctrl+Alt+←', action: () => ({ type: 'media', cmd: 'prev' }) },
    { words: ['заблокировать', 'блокировка', 'lock'], name: () => 'Заблокировать компьютер', kind: 'Система', action: () => ({ type: 'system', cmd: 'lock' }) },
    { words: ['сон', 'спящий режим', 'спать', 'sleep'], name: () => 'Спящий режим', kind: 'Система', action: () => ({ type: 'system', cmd: 'sleep' }) },
    { words: ['выключить', 'выключи', 'выключение', 'shutdown'], name: (n) => (n ? `Выключить компьютер через ${n} мин` : 'Выключить компьютер'), kind: 'Система · спросит подтверждение', action: (n) => ({ type: 'system', cmd: 'shutdown', minutes: n ?? 0 }) },
    { words: ['перезагрузить', 'перезагрузка', 'restart', 'reboot'], name: () => 'Перезагрузить компьютер', kind: 'Система · спросит подтверждение', action: () => ({ type: 'system', cmd: 'restart' }) },
    { words: ['отмена выключения', 'отменить выключение', 'не выключай'], name: () => 'Отменить выключение по таймеру', kind: 'Система', action: () => ({ type: 'system', cmd: 'cancel' }) },
    { words: ['корзина', 'очистить корзину', 'trash'], name: () => 'Очистить корзину', kind: 'Система · спросит подтверждение', action: () => ({ type: 'system', cmd: 'empty-bin' }) },
    { words: ['настройки', 'settings'], name: () => 'Настройки', kind: 'Familiar', action: () => ({ type: 'open', what: 'settings' }) },
    { words: ['файлы', 'files'], name: () => 'Файлы', kind: 'Familiar', action: () => ({ type: 'open', what: 'files' }) },
    { words: ['виджеты', 'widgets'], name: () => 'Показать или скрыть виджеты', kind: 'Alt+W', action: () => ({ type: 'open', what: 'widgets' }) }
  ]

  function commands(query) {
    const q = query.toLowerCase().trim()
    if (q.length < 2) return []
    const n = parseInt(q.match(/\d+/)?.[0], 10)
    const words = q.replace(/\d+/g, '').replace(/\s*(мин|минут|минуты|м)\b/g, '').trim()
    const fits = (w) => w.startsWith(words) || words === w || words.startsWith(w + ' ')
    return COMMANDS.filter((c) => words.length >= 2 && c.words.some(fits))
      .slice(0, 3)
      .map((c) => ({ name: c.name(Number.isFinite(n) ? n : undefined), kind: c.kind, action: c.action(Number.isFinite(n) ? Math.min(n, 600) : undefined), icon: 'cmd' }))
  }

  // ---------- Всё вместе ----------

  function answers(query, { engine = 'yandex' } = {}) {
    const q = query.trim()
    if (!q) return { top: [], web: null }
    // «? запрос» — только поиск в интернете
    if (q.startsWith('?')) return { top: [], web: webItem(q.slice(1).trim(), engine), only: true }
    const top = [calc(q) ?? units(q), ...commands(q)].filter(Boolean)
    return { top, web: webItem(q, engine) }
  }

  function webItem(q, engine) {
    if (!q) return null
    return { name: `Найти в ${engine === 'google' ? 'Google' : 'Яндексе'}: ${q}`, kind: 'Интернет · откроется браузер', action: { type: 'web', query: q }, icon: 'web' }
  }

  window.Quick = { answers, evaluate, units }
})()
