import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  formatShiftOpenReport,
  formatShiftCloseReport,
  trySendSnapshot,
  trySendReport,
  retryPending,
  getSnapshotStatus,
} from './cloud.js'
import { getConfig } from './db.js'

vi.mock('./db.js', () => ({
  exportBackup: vi.fn(async () => ({ version: 3, products: [] })),
  getConfig: vi.fn(async () => ({
    locationName: 'Магазин',
    snapshot: { url: 'https://proxy.test/exec', token: 'secret' },
  })),
}))

// Мокаємо localStorage (той самий підхід, що в sync.test.js)
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

function okResponse(extra = {}) {
  return { ok: true, json: async () => ({ ok: true, file: 'kasa-x.json', ...extra }) }
}

// Фіксований локальний час, щоб перевіряти формат гг:хх незалежно від дати запуску
const openedAt = new Date(2026, 6, 12, 9, 5).getTime()
const closedAt = new Date(2026, 6, 12, 21, 30).getTime()

const closedShift = {
  loc: 'Магазин',
  cashier: 'Оксана',
  openedAt,
  closedAt,
  closedBy: 'cashier',
  receiptCount: 5,
  stornoCount: 0,
  total: 950,
  cashTotal: 650,
  cardTotal: 300,
  openingCash: 500,
  countedCash: 150,
  expectedCash: 150,
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => okResponse()))
  getConfig.mockResolvedValue({
    locationName: 'Магазин',
    snapshot: { url: 'https://proxy.test/exec', token: 'secret' },
  })
})

describe('formatShiftOpenReport', () => {
  it('містить точку, касира, час і розмінну', () => {
    const text = formatShiftOpenReport({ loc: 'Магазин', cashier: 'Оксана', openedAt, openingCash: 500 })
    expect(text).toContain('🟢')
    expect(text).toContain('<b>Магазин</b>')
    expect(text).toContain('09:05')
    expect(text).toContain('Оксана')
    expect(text).toContain('500 ₴')
  })

  it('екранує HTML у назві точки і касирі', () => {
    const text = formatShiftOpenReport({ loc: 'A<b>&', cashier: '<i>', openedAt, openingCash: 0 })
    expect(text).toContain('A&lt;b&gt;&amp;')
    expect(text).toContain('&lt;i&gt;')
    expect(text).not.toContain('<i>')
  })
})

describe('formatShiftCloseReport', () => {
  it('звичайне закриття: ✅, виторг, готівка зійшлася', () => {
    const text = formatShiftCloseReport(closedShift)
    expect(text).toContain('✅')
    expect(text).toContain('21:30')
    expect(text).toContain('Чеків: 5')
    expect(text).toContain('950 ₴')
    expect(text).toContain('готівка 650 ₴')
    expect(text).toContain('картка 300 ₴')
    expect(text).toContain('✓ зійшлося')
    expect(text).not.toContain('сторно')
  })

  it('недостача: показує Δ і очікувану суму', () => {
    const text = formatShiftCloseReport({ ...closedShift, countedCash: 100, expectedCash: 150 })
    expect(text).toContain('⚠️')
    expect(text).toContain('мало бути 150 ₴')
    expect(text).toContain('Δ -50 ₴')
  })

  it('надлишок: Δ з плюсом', () => {
    const text = formatShiftCloseReport({ ...closedShift, countedCash: 200, expectedCash: 150 })
    expect(text).toContain('Δ +50 ₴')
  })

  it('сторно згадується лише коли воно було', () => {
    const text = formatShiftCloseReport({ ...closedShift, stornoCount: 2 })
    expect(text).toContain('↩️ сторно: 2')
  })

  it('готівку не перераховано — окремий рядок з очікуваною сумою', () => {
    const text = formatShiftCloseReport({ ...closedShift, countedCash: null, expectedCash: 150 })
    expect(text).toContain('не перераховано')
    expect(text).toContain('150 ₴')
  })

  it('автозакриття системою: 🔴, без рядка про готівку', () => {
    const text = formatShiftCloseReport({
      ...closedShift, closedBy: 'system', countedCash: null, expectedCash: null,
    })
    expect(text).toContain('🔴')
    expect(text).toContain('автоматично системою')
    expect(text).not.toContain('💵')
  })
})

describe('trySendSnapshot', () => {
  it('успіх: шле снапшот і звіт одним запитом, фіксує час, чистить прапорець', async () => {
    localStorage.setItem('snapshotPending', '1')
    const res = await trySendSnapshot('звіт')
    expect(res.ok).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.token).toBe('secret')
    expect(body.locationName).toBe('Магазин')
    expect(body.snapshot).toBeTruthy()
    expect(body.report).toBe('звіт')
    expect(getSnapshotStatus().pending).toBe(false)
    expect(getSnapshotStatus().lastOkAt).toBeTruthy()
  })

  it('невдача: ставить прапорець і кладе звіт у чергу', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const res = await trySendSnapshot('звіт')
    expect(res.ok).toBe(false)
    expect(getSnapshotStatus().pending).toBe(true)
    expect(JSON.parse(localStorage.getItem('pendingReports'))).toEqual(['звіт'])
  })

  it('не налаштовано: без прапорця і без черги', async () => {
    getConfig.mockResolvedValue({ locationName: 'Магазин' })
    const res = await trySendSnapshot('звіт')
    expect(res.ok).toBe(false)
    expect(getSnapshotStatus().pending).toBe(false)
    expect(localStorage.getItem('pendingReports')).toBeNull()
  })
})

describe('trySendReport', () => {
  it('успіх: шле лише звіт, без снапшота', async () => {
    const res = await trySendReport('відкрито')
    expect(res.ok).toBe(true)
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body.report).toBe('відкрито')
    expect(body.snapshot).toBeUndefined()
    expect(localStorage.getItem('pendingReports')).toBeNull()
  })

  it('невдача: звіт у чергу на повтор', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await trySendReport('відкрито')
    expect(JSON.parse(localStorage.getItem('pendingReports'))).toEqual(['відкрито'])
  })

  it('черга обмежена 20 записами — найстаріші відкидаються', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    for (let i = 1; i <= 25; i++) await trySendReport(`звіт ${i}`)
    const queue = JSON.parse(localStorage.getItem('pendingReports'))
    expect(queue).toHaveLength(20)
    expect(queue[0]).toBe('звіт 6')
    expect(queue[19]).toBe('звіт 25')
  })
})

describe('retryPending', () => {
  it('досилає чергу звітів по порядку, потім свіжий снапшот', async () => {
    localStorage.setItem('pendingReports', JSON.stringify(['перший', 'другий']))
    localStorage.setItem('snapshotPending', '1')
    await retryPending()
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(JSON.parse(fetch.mock.calls[0][1].body).report).toBe('перший')
    expect(JSON.parse(fetch.mock.calls[1][1].body).report).toBe('другий')
    expect(JSON.parse(fetch.mock.calls[2][1].body).snapshot).toBeTruthy()
    expect(localStorage.getItem('pendingReports')).toBe('[]')
    expect(getSnapshotStatus().pending).toBe(false)
  })

  it('мережі досі немає: черга і прапорець лишаються на місці', async () => {
    localStorage.setItem('pendingReports', JSON.stringify(['перший', 'другий']))
    localStorage.setItem('snapshotPending', '1')
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await retryPending()
    expect(JSON.parse(localStorage.getItem('pendingReports'))).toEqual(['перший', 'другий'])
    expect(getSnapshotStatus().pending).toBe(true)
  })

  it('не налаштовано: нічого не шле', async () => {
    getConfig.mockResolvedValue({ locationName: 'Магазин' })
    localStorage.setItem('pendingReports', JSON.stringify(['перший']))
    await retryPending()
    expect(fetch).not.toHaveBeenCalled()
  })
})
