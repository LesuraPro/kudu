// Профили: у каждого имя, фото и свои настройки — закреплённые приложения,
// набор и расположение виджетов, тема, палитра и обои.
// Настройки текущего профиля живут прямо в config (config.pinned и т.д.),
// а в config.profiles[id] лежат имя, фото и «снимок» настроек остальных профилей.

const KEYS = ['pinned', 'widgets', 'theme', 'wallpaper', 'palette', 'wallpaperPalette']

const snapshot = (config) => structuredClone(Object.fromEntries(KEYS.map((k) => [k, config[k]])))

// Старые версии хранили профили по названиям без поля name — чиним
function migrate(config) {
  config.profiles ??= {}
  for (const [id, p] of Object.entries(config.profiles)) p.name ??= id
  if (!config.profile) config.profile = 'Основной'
  config.profiles[config.profile] ??= { name: config.profile }
}

function list(config) {
  return Object.entries(config.profiles).map(([id, p]) => ({ id, name: p.name, photo: p.photo ?? null, current: id === config.profile }))
}

function switchTo(config, id) {
  if (id === config.profile || !config.profiles[id]) return false
  Object.assign(config.profiles[config.profile], snapshot(config))
  const next = config.profiles[id]
  for (const k of KEYS) if (next[k] !== undefined) config[k] = structuredClone(next[k])
  config.profile = id
  return true
}

// Новый профиль начинается копией текущего
function create(config, name) {
  const id = 'p' + Date.now().toString(36)
  config.profiles[id] = { name: name.trim() || 'Новый профиль', ...snapshot(config) }
  return id
}

function remove(config, id) {
  if (id === config.profile || Object.keys(config.profiles).length < 2) return false
  delete config.profiles[id]
  return true
}

function update(config, id, { name, photo }) {
  const p = config.profiles[id]
  if (!p) return false
  if (name !== undefined) p.name = name.trim() || p.name
  if (photo !== undefined) p.photo = photo
  return true
}

const current = (config) => ({ id: config.profile, ...config.profiles[config.profile] })

module.exports = { migrate, list, switchTo, create, remove, update, current }
