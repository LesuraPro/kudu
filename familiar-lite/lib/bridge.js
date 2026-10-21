// Связь с Windows через PowerShell (bridge.ps1): музыка, открытые окна, фокус,
// место под верхнюю панель, обои. Скрипт присылает строки JSON, мы шлём ему команды.
// В демо-режиме (FAMILIAR_DEMO=1) вместо Windows — выдуманные данные.
const path = require('path')
const fs = require('fs')
const readline = require('readline')
const { spawn } = require('child_process')

function startBridge({ app, isDemo, onMessage }) {
  if (isDemo) return startDemo(onMessage)
  if (process.platform !== 'win32') return { send() {}, stop() {} }

  // Из asar-архива PowerShell файл не прочитает — копируем скрипт рядом с настройками
  const script = path.join(app.getPath('userData'), 'bridge.ps1')
  fs.mkdirSync(path.dirname(script), { recursive: true })
  fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, '..', 'bridge.ps1')))

  let proc = null
  let restarts = 0
  let stopped = false

  function start() {
    proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      windowsHide: true
    })
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      try {
        onMessage(JSON.parse(line))
      } catch {
        // не JSON — пропускаем
      }
    })
    proc.stderr.on('data', (d) => console.error('[bridge]', String(d).trim()))
    proc.on('exit', (code) => {
      proc = null
      onMessage({ type: 'media', status: 'none' })
      // Пару раз пробуем перезапустить, дальше сдаёмся без спама
      if (!stopped && restarts++ < 3) {
        console.error(`[bridge] вышел с кодом ${code}, перезапуск через 5 с`)
        setTimeout(start, 5000)
      }
    })
  }
  start()

  return {
    send: (cmd) => proc?.stdin.write(cmd + '\n'),
    // Закрытый stdin — сигнал скрипту вернуть место под панель и выйти
    stop() {
      stopped = true
      proc?.stdin.end()
    }
  }
}

// ---------- Демо ----------

function startDemo(onMessage) {
  const tracks = [
    { title: 'zany', artist: 'DJ SENSX', album: 'zany', duration: 78 },
    { title: 'Кукла колдуна', artist: 'Король и Шут', album: 'Акустический альбом', duration: 203 }
  ]
  let i = 0
  let position = 35
  let playing = true
  const media = () => {
    const t = tracks[i]
    onMessage({ type: 'media', status: playing ? 'playing' : 'paused', app: 'Spotify.exe', ...t, position, key: t.title, art: '' })
  }

  // Пара «открытых окон» из того, что точно есть на Linux
  const windows = [
    { hwnd: 101, title: 'bash', path: '/usr/bin/bash', pid: 1 },
    { hwnd: 102, title: 'Telegram', path: '/usr/bin/xterm', pid: 2 },
    { hwnd: 103, title: 'Лабораторная №3.docx — LibreOffice', path: '/usr/bin/soffice', pid: 3 }
  ]
  let foreground = 102

  const timer = setInterval(() => {
    if (playing) position += 1
    if (position > tracks[i].duration) (i = (i + 1) % tracks.length), (position = 0)
    media()
    onMessage({ type: 'windows', list: windows, foreground })
  }, 1000)
  media()
  onMessage({ type: 'windows', list: windows, foreground })

  return {
    send(cmd) {
      const [name, arg] = cmd.split(' ')
      if (name === 'toggle') playing = !playing
      if (name === 'next') (i = (i + 1) % tracks.length), (position = 0)
      if (name === 'prev') position = 0
      if (name === 'focus') foreground = Number(arg)
      media()
    },
    stop: () => clearInterval(timer)
  }
}

module.exports = { startBridge }
