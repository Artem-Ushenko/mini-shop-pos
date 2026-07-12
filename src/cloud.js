import { exportBackup, getConfig } from './db.js'

// ── Хмарні снапшоти бази + Telegram-звіти через Apps Script-проксі ──────────
// Каса POST-ить на Web App (gerkules-snapshot-proxy.gs): повний JSON-бекап
// (той кладе файл у папку Google Drive власника) і/або текстовий звіт зміни
// (той пересилає його в Telegram, якщо на проксі задані BOT_TOKEN/CHAT_ID).
// Секретний токен живе в config (IndexedDB пристрою), НЕ в публічному бандлі.
//
// Принцип каси незмінний: продаж і відкриття/закриття зміни ніколи не чекають
// хмару. Невдала відправка ставить прапорець/чергу і повторюється при мережі.

const PENDING_KEY = 'snapshotPending'
const LAST_OK_KEY = 'lastSnapshotAt'
const REPORTS_KEY = 'pendingReports'
const MAX_QUEUED_REPORTS = 20
const SEND_TIMEOUT_MS = 30_000

// ── Текст звітів (Telegram HTML) ────────────────────────────────────────────

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
}

function money(n) {
  return `${Math.round(Number(n) || 0).toLocaleString('uk-UA')} ₴`
}

export function formatShiftOpenReport(shift) {
  return `🟢 <b>${esc(shift.loc)}</b> — зміну відкрито о ${fmtTime(shift.openedAt)}\n` +
    `👤 ${esc(shift.cashier)} · розмінна ${money(shift.openingCash)}`
}

export function formatShiftCloseReport(shift) {
  const bySystem = shift.closedBy === 'system'
  const lines = [
    `${bySystem ? '🔴' : '✅'} <b>${esc(shift.loc)}</b> — зміну закрито о ${fmtTime(shift.closedAt)}` +
      (bySystem ? ' <b>автоматично системою</b> (не закрили вручну)' : ''),
    `👤 ${esc(shift.cashier)} · відкрито о ${fmtTime(shift.openedAt)}`,
    `🧾 Чеків: ${shift.receiptCount}` +
      (shift.stornoCount > 0 ? ` · ↩️ сторно: ${shift.stornoCount}` : ''),
    `💰 Виторг: <b>${money(shift.total)}</b> (готівка ${money(shift.cashTotal)} · картка ${money(shift.cardTotal)})`,
  ]
  if (shift.countedCash != null) {
    const delta = shift.countedCash - (shift.expectedCash ?? 0)
    lines.push(delta === 0
      ? `💵 Готівка в касі: ${money(shift.countedCash)} — ✓ зійшлося`
      : `💵 Готівка в касі: ${money(shift.countedCash)}, мало бути ${money(shift.expectedCash)} — ⚠️ Δ ${delta > 0 ? '+' : ''}${money(delta)}`)
  } else if (!bySystem) {
    lines.push(`💵 Готівку не перераховано (мало бути ${money(shift.expectedCash)})`)
  }
  return lines.join('\n')
}

// ── Відправка на проксі ─────────────────────────────────────────────────────

export function getSnapshotStatus() {
  return {
    lastOkAt: Number(localStorage.getItem(LAST_OK_KEY)) || null,
    pending: localStorage.getItem(PENDING_KEY) === '1',
  }
}

export async function isSnapshotConfigured() {
  const config = await getConfig()
  return Boolean(config?.snapshot?.url && config?.snapshot?.token)
}

// Спільний POST: токен + назва точки + payload ({snapshot} і/або {report}).
async function postToProxy(payload) {
  const config = await getConfig()
  const { url, token } = config?.snapshot ?? {}
  if (!url || !token) {
    const err = new Error('Хмарні снапшоти не налаштовані (Бекапи → Хмарні снапшоти)')
    err.code = 'NOT_CONFIGURED'
    throw err
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
  try {
    // Без заголовків: тіло йде як text/plain — «простий» запит без CORS-preflight,
    // якого Apps Script Web App не вміє обробити (OPTIONS повертає помилку).
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ token, locationName: config.locationName, ...payload }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'проксі відхилив запит')
    return data
  } finally {
    clearTimeout(timer)
  }
}

// Надсилає свіжий снапшот (+ опційний звіт тим самим запитом).
// Кидає помилку, якщо не налаштовано або не вдалося.
export async function sendSnapshot(reportText) {
  const backup = await exportBackup()
  const data = await postToProxy(reportText ? { snapshot: backup, report: reportText } : { snapshot: backup })
  localStorage.setItem(LAST_OK_KEY, String(Date.now()))
  localStorage.removeItem(PENDING_KEY)
  return data
}

// Обгортка «не впасти»: для тригерів (закриття зміни), де помилка хмари
// не має блокувати касу. Невдача → прапорець повтору снапшота + звіт у чергу.
export async function trySendSnapshot(reportText) {
  try {
    const data = await sendSnapshot(reportText)
    return { ok: true, file: data.file }
  } catch (e) {
    if (e.code !== 'NOT_CONFIGURED') {
      localStorage.setItem(PENDING_KEY, '1')
      if (reportText) queueReport(reportText)
    }
    return { ok: false, error: e.message }
  }
}

// Звіт без снапшота (відкриття зміни). Невдача → у чергу на повтор.
export async function trySendReport(reportText) {
  try {
    const data = await postToProxy({ report: reportText })
    return { ok: true, telegram: data.telegram }
  } catch (e) {
    if (e.code !== 'NOT_CONFIGURED') queueReport(reportText)
    return { ok: false, error: e.message }
  }
}

function getQueuedReports() {
  try {
    const arr = JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function queueReport(text) {
  const queue = [...getQueuedReports(), text]
  localStorage.setItem(REPORTS_KEY, JSON.stringify(queue.slice(-MAX_QUEUED_REPORTS)))
}

// Повтор відкладеного (виклик при старті каси і на подію online):
// спершу звіти в порядку виникнення, потім снапшот — надсилається СВІЖИЙ
// стан бази, для снапшота новіше завжди краще.
export async function retryPending() {
  if (!(await isSnapshotConfigured())) return

  let queue = getQueuedReports()
  while (queue.length) {
    try {
      await postToProxy({ report: queue[0] })
    } catch {
      break // мережі досі немає — решта черги чекає наступної спроби
    }
    queue = queue.slice(1)
    localStorage.setItem(REPORTS_KEY, JSON.stringify(queue))
  }

  if (localStorage.getItem(PENDING_KEY) === '1') await trySendSnapshot()
}
