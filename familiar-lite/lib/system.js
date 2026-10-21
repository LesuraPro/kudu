// Нагрузка процессора и памяти, сведения о системе, батареи Bluetooth-устройств
const os = require('os')
const { execFile } = require('child_process')

const isWin = process.platform === 'win32'

// Загрузка ЦП = доля времени, которое ядра не простаивали, между двумя замерами
function cpuTimes() {
  return os.cpus().reduce(
    (acc, c) => {
      const t = c.times
      acc.idle += t.idle
      acc.total += t.user + t.nice + t.sys + t.idle + t.irq
      return acc
    },
    { idle: 0, total: 0 }
  )
}

function startStats(onStats, intervalMs = 1000) {
  let prev = cpuTimes()
  return setInterval(() => {
    const now = cpuTimes()
    const total = now.total - prev.total
    const cpu = total > 0 ? 1 - (now.idle - prev.idle) / total : 0
    prev = now
    onStats({ cpu, mem: 1 - os.freemem() / os.totalmem(), memTotal: os.totalmem(), at: Date.now() })
  }, intervalMs)
}

function systemInfo(screen) {
  const { size } = screen.getPrimaryDisplay()
  const cpus = os.cpus()
  return {
    user: os.userInfo().username,
    host: os.hostname(),
    os: isWin ? `Windows ${os.release()}` : `${os.type()} ${os.release()}`,
    arch: os.arch(),
    cpu: cpus[0]?.model.replace(/\s+/g, ' ').trim() ?? '?',
    cores: cpus.length,
    memTotal: os.totalmem(),
    memFree: os.freemem(),
    uptime: os.uptime(),
    resolution: `${size.width}x${size.height}`,
    electron: process.versions.electron
  }
}

// Заряд наушников, мышек и т.п. Windows хранит его в свойстве устройства
// DEVPKEY_Bluetooth_Battery — то же число, что в «Параметры → Bluetooth».
const BATTERY_SCRIPT = `
$key = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
$out = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'BTH*' } | ForEach-Object {
  $p = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName $key -ErrorAction SilentlyContinue
  if ($p -and $p.Data -ne $null) { @{ name = $_.FriendlyName; battery = [int]$p.Data } }
})
ConvertTo-Json -InputObject $out -Compress
`

function readBatteries(isDemo) {
  if (isDemo) {
    return Promise.resolve([
      { name: 'AirPods Pro', battery: 85 },
      { name: 'MX Master 3', battery: 18 }
    ])
  }
  if (!isWin) return Promise.resolve([])
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', BATTERY_SCRIPT],
      { windowsHide: true, timeout: 30000 },
      (err, stdout) => {
        if (err) return resolve([])
        try {
          // Одно устройство может числиться дважды (классика + LE) — оставляем по имени
          // «AirPods Pro Hands-Free AG» → «AirPods Pro»
          const byName = new Map()
          for (const d of JSON.parse(stdout.trim() || '[]')) {
            const name = d.name.replace(/\s+(Hands-Free.*|Stereo|Avrcp.*|LE)$/i, '').trim()
            if (!byName.has(name) || byName.get(name).battery < d.battery) byName.set(name, { name, battery: d.battery })
          }
          resolve([...byName.values()])
        } catch {
          resolve([])
        }
      }
    )
  })
}

module.exports = { startStats, systemInfo, readBatteries }
