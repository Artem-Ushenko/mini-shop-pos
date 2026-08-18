// Бекап через File System Access API — той самий принцип, що в
// сестринському проєкті екосистеми (Геркулес Клуб, src/backup.js):
// датовані JSON-знімки в папку, синхронізовану Google Drive for Desktop.
// Ніякого Google API й токенів — обрана папка (напр. диск G:) це звичайна
// тека на файловій системі. Незалежно від хмарних снапшотів (cloud.js,
// HTTP-проксі + Telegram) — це другий, повністю офлайн-канал бекапу.

import { exportBackup, getMeta, setMeta } from './db.js'

const HANDLE_KEY = 'localBackupDirHandle'
const LAST_KEY = 'localBackupLastAt'
const FILE_RE = /^gerkules-shop-\d{4}-\d{2}-\d{2}-\d{4}\.json$/

// Ті самі значення, що в Клубі (config.js: BACKUP_INTERVAL_MIN/BACKUP_KEEP) —
// свідомо однаковий стек, свій центральний config.js Шопу поки не заводимо.
const BACKUP_INTERVAL_MIN = 120
const BACKUP_KEEP = 30

let dirHandle = null
let timer = null
let statusListeners = []

// ── Стан для індикатора в шапці/екрані бекапів ──

let state = { configured: false, permissionOk: false, lastBackupAt: null, lastError: null }

function emit() {
  for (const fn of statusListeners) fn(state)
}

// Повертає функцію відписки — виклик кожен раз, коли перебудовується екран,
// інакше слухачі накопичуються, поки застосунок працює годинами (PWA не перезавантажується)
export function onLocalBackupStatusChange(fn) {
  statusListeners.push(fn)
  fn(state)
  return () => { statusListeners = statusListeners.filter(l => l !== fn) }
}

// ── Ініціалізація при старті ──

export async function initLocalBackup() {
  state.lastBackupAt = await getMeta(LAST_KEY)
  const handle = await getMeta(HANDLE_KEY)
  if (!handle) {
    state.configured = false
    emit()
    return
  }
  dirHandle = handle
  state.configured = true
  // queryPermission не потребує жесту користувача — можна перевірити одразу
  const perm = await dirHandle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied')
  state.permissionOk = perm === 'granted'
  emit()
  if (state.permissionOk) startSchedule()
  bindAutoReconfirm()
}

// Chrome скидає дозвіл readwrite на збережений FileSystemDirectoryHandle при
// кожному новому запуску браузера — queryPermission() одразу після старту
// повертає не 'granted', навіть якщо дозвіл уже надавали раніше.
// requestPermission() у відповідь на той самий дозвіл зазвичай не показує
// діалог повторно (Chrome тихо підтверджує вже наданий сайту дозвіл) — але
// вимагає жесту користувача, тож ловимо перший клік будь-де в застосунку і,
// поки дозволу нема, тихо перевіряємо — без походу в Налаштування.
// Той самий прийом, що в Клубі (backup.js).
let lastAutoReconfirmAt = 0
let autoReconfirmBound = false
function bindAutoReconfirm() {
  if (autoReconfirmBound) return
  autoReconfirmBound = true
  document.addEventListener('click', async () => {
    if (state.permissionOk || !dirHandle) return
    const now = Date.now()
    if (now - lastAutoReconfirmAt < 30000) return
    lastAutoReconfirmAt = now
    await reconfirmLocalBackupPermission()
  })
}

// ── Вибір / перевидача папки (потребує жесту користувача — виклик з onclick) ──

export async function pickLocalBackupFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
  dirHandle = handle
  await setMeta(HANDLE_KEY, handle)
  state.configured = true
  state.permissionOk = true
  state.lastError = null
  emit()
  startSchedule()
  await writeLocalBackup()
}

export async function reconfirmLocalBackupPermission() {
  if (!dirHandle) return pickLocalBackupFolder()
  const perm = await dirHandle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied')
  state.permissionOk = perm === 'granted'
  emit()
  if (state.permissionOk) startSchedule()
  return state.permissionOk
}

// ── Запис бекапу ──

function pad2(n) { return String(n).padStart(2, '0') }

function backupFilename(d = new Date()) {
  return `gerkules-shop-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.json`
}

export async function writeLocalBackup() {
  if (!dirHandle) return { ok: false, reason: 'not-configured' }
  try {
    const perm = await dirHandle.queryPermission({ mode: 'readwrite' })
    if (perm !== 'granted') {
      state.permissionOk = false
      emit()
      return { ok: false, reason: 'no-permission' }
    }
    const backup = await exportBackup()
    const fileHandle = await dirHandle.getFileHandle(backupFilename(), { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(JSON.stringify(backup, null, 2))
    await writable.close()

    await rotate()

    const at = Date.now()
    await setMeta(LAST_KEY, at)
    state.lastBackupAt = at
    state.lastError = null
    state.permissionOk = true
    emit()
    return { ok: true }
  } catch (err) {
    state.lastError = err.message
    // Втрата доступу до теки (видалили, від'єднали диск) — не блокує роботу каси
    if (err.name === 'NotAllowedError' || err.name === 'NotFoundError') state.permissionOk = false
    emit()
    return { ok: false, reason: err.message }
  }
}

// Зберігаються останні BACKUP_KEEP файлів — зіпсований знімок не має затерти попередні
async function rotate() {
  const names = []
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file' && FILE_RE.test(name)) names.push(name)
  }
  names.sort() // формат імені сортується лексикографічно = хронологічно
  const excess = names.length - BACKUP_KEEP
  for (let i = 0; i < excess; i++) {
    await dirHandle.removeEntry(names[i]).catch(() => {})
  }
}

// ── Розклад: інтервал + закриття вкладки ──

function startSchedule() {
  if (timer) clearInterval(timer)
  timer = setInterval(writeLocalBackup, BACKUP_INTERVAL_MIN * 60000)
}

let unloadBound = false
export function bindLocalBackupUnload() {
  if (unloadBound) return
  unloadBound = true
  // visibilitychange надійніший за beforeunload для асинхронного запису
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') writeLocalBackup()
  })
  window.addEventListener('pagehide', () => writeLocalBackup())
}

// ── Формат статусу (для UI) ──

export function formatLocalBackupStatus(s) {
  if (!s.configured) return { text: 'Копія на диск: не налаштовано', stale: true }
  if (!s.permissionOk) return { text: 'Копія на диск: немає доступу до папки', stale: true }
  if (!s.lastBackupAt) return { text: 'Копія на диск: ще не робилась', stale: true }

  const ageMin = (Date.now() - s.lastBackupAt) / 60000
  const staleAfter = BACKUP_INTERVAL_MIN * 2 // подвійний інтервал без бекапу — вже проблема
  const d = new Date(s.lastBackupAt)
  const time = d.toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' })

  if (ageMin <= staleAfter) return { text: `Копія на диск: ${time} ✓`, stale: false }

  const days = Math.floor(ageMin / 1440)
  const hours = Math.floor(ageMin / 60)
  const text = days >= 1 ? `Копія на диск: ${days} дн. тому ⚠` : `Копія на диск: ${hours} год тому ⚠`
  return { text, stale: true }
}

export function getLocalBackupFolderName() {
  return dirHandle ? dirHandle.name : ''
}

export { BACKUP_INTERVAL_MIN, BACKUP_KEEP }
