import { openDB } from 'idb'

const DB_NAME = 'kasa-db'
const DB_VERSION = 3

// Товари, додані вручну через касу, отримують id з цього діапазону —
// щоб ніколи не перетнутись з id з WooCommerce/Google Таблиці.
const MANUAL_ID_START = 900_000

// Дозволені причини сторно — чек без причини скасувати не можна.
// «виправлення» — службова причина правки чека: сторно + перебиття новим чеком.
export const CANCEL_REASONS = ['помилка', 'повернення', 'виправлення']

// Способи оплати чека. Старі чеки без paymentMethod рахуються готівкою.
export const PAYMENT_METHODS = ['готівка', 'картка']

// ЄДИНЕ місце розрахунку сум чека — екран оплати і createReceipt зобов'язані
// використовувати саме цю функцію, інакше сума на екрані та в чеку розійдуться
// на 1 ₴ через різний порядок округлення (реальний баг: 105 ₴ зі знижкою 10%).
// Правило: знижка округлюється до цілої ₴, разом = сума − знижка.
export function calcReceiptTotals(items, discount = 0) {
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0)
  const discountAmt = Math.round(subtotal * discount / 100)
  return { subtotal, discountAmt, total: subtotal - discountAmt }
}

let _db = null

// Тільки для тестів — скидає singleton
export function _resetDB() { _db = null }

const REQUIRED_STORES = ['categories', 'products', 'receipts', 'shifts', 'config', 'deliveries']

// Ідемпотентне створення сховищ — викликається і при плановому апгрейді,
// і при самовідновленні половинчастої бази.
function createMissingStores(db) {
  if (!db.objectStoreNames.contains('categories')) {
    const cats = db.createObjectStore('categories', { keyPath: 'id' })
    cats.createIndex('order', 'order')
  }
  if (!db.objectStoreNames.contains('products')) {
    const prods = db.createObjectStore('products', { keyPath: 'id' })
    prods.createIndex('cat', 'cat')
  }
  if (!db.objectStoreNames.contains('receipts')) {
    const recs = db.createObjectStore('receipts', { keyPath: 'no', autoIncrement: true })
    recs.createIndex('time', 'time')
  }
  if (!db.objectStoreNames.contains('shifts')) {
    db.createObjectStore('shifts', { keyPath: 'id' })
  }
  if (!db.objectStoreNames.contains('config')) {
    db.createObjectStore('config')
  }
  if (!db.objectStoreNames.contains('deliveries')) {
    const dels = db.createObjectStore('deliveries', { keyPath: 'id', autoIncrement: true })
    dels.createIndex('time', 'time')
  }
}

// Обробники подій багатовкладкової роботи (передаються в кожен openDB):
// - blocked: апгрейд чекає на іншу вкладку зі старою версією — без обробника
//   каса зависла б на «Завантаження…» назавжди; краще чесна помилка.
// - blocking: інша вкладка хоче апгрейд, а ми тримаємо з'єднання — відпускаємо
//   його і перезавантажуємось на новий код.
function multiTabHandlers(reject) {
  return {
    blocked() {
      reject(new Error('База зайнята іншою вкладкою каси — закрийте інші вкладки і оновіть сторінку'))
    },
    blocking() {
      _db?.close()
      _db = null
      if (typeof window !== 'undefined') window.location.reload()
    },
  }
}

function openWithHandlers(version) {
  return new Promise((resolve, reject) => {
    openDB(DB_NAME, version, { upgrade: createMissingStores, ...multiTabHandlers(reject) })
      .then(resolve, reject)
  })
}

export async function initDB() {
  if (_db) return
  let db = await openWithHandlers(DB_VERSION)
    .catch(err => {
      // БД уже на вищій версії, ніж знає код (напр. після самовідновлення
      // нижче) — відкриваємо як є, сховища перевіримо окремо.
      if (err.name === 'VersionError') return openWithHandlers(undefined)
      throw err
    })

  // Самовідновлення: якщо БД позначена актуальною версією, але якогось
  // сховища бракує (половинчастий апгрейд — напр. вкладка з проміжним кодом),
  // upgrade-колбек сам по собі більше не запуститься. Форсуємо його
  // підняттям версії на 1 — createMissingStores створить лише відсутнє.
  if (REQUIRED_STORES.some(s => !db.objectStoreNames.contains(s))) {
    const healVersion = db.version + 1
    db.close()
    db = await openWithHandlers(healVersion)
  }

  _db = db
  // Просимо браузер не витісняти IndexedDB при нестачі місця (best effort,
  // відмова не критична — тому без await і без обробки результату).
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {})
  }
}

function db() {
  if (!_db) throw new Error('DB не ініціалізована. Спочатку викличте initDB()')
  return _db
}

// ── Конфіг точки ───────────────────────────────────────────
// { locationName: "Магазин, вул. Шевченка 12", cashiers: ["Оксана", ...] }
// Кожен пристрій — самостійна каса однієї точки; назву/адресу вводить
// власник при першому запуску, вона фіксується у змінах і чеках.

const CONFIG_KEY = 'main'

export async function getConfig() {
  return (await db().get('config', CONFIG_KEY)) ?? null
}

export async function setConfig(cfg) {
  if (!cfg || typeof cfg.locationName !== 'string' || !cfg.locationName.trim() || !Array.isArray(cfg.cashiers)) {
    throw new Error('Невірний конфіг: потрібні назва точки (locationName) і cashiers[]')
  }
  const normalized = { ...cfg, locationName: cfg.locationName.trim() }
  await db().put('config', normalized, CONFIG_KEY)
  return normalized
}

// ── Зміни ──────────────────────────────────────────────────
// shift: { id, loc, cashier, openedAt, closedAt, closedBy,
//          receiptCount, stornoCount, total }
// loc — назва точки з конфігу. id — читабельний: "{точка}-2026-07-08";
// якщо зміну цього дня вже відкривали (перезміна) — суфікс "-2", "-3",
// щоб id лишався унікальним.

function localDateStr(ts) {
  const d = new Date(ts)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export async function getCurrentShift() {
  const all = await db().getAll('shifts')
  return all.find(s => !s.closedAt) ?? null
}

// Відкриває зміну. Якщо існує незакрита стара зміна (забули закрити) —
// спочатку закриває її від імені системи. Повертає { shift, autoClosed },
// де autoClosed — автозакрита стара зміна або null.
// openingCash — розмінна готівка в шухляді на початку зміни (₴).
export async function openShift(cashier, openingCash = 0) {
  const name = (cashier ?? '').trim()
  if (!name) throw new Error('Вкажіть касира, який відкриває зміну')
  const opening = Math.round(Number(openingCash) || 0)
  if (opening < 0) throw new Error('Розмінна готівка не може бути від\'ємною')

  const config = await getConfig()
  if (!config?.locationName) throw new Error('Каса не налаштована — спочатку вкажіть точку продажу')

  const tx = db().transaction('shifts', 'readwrite')
  const store = tx.objectStore('shifts')
  const all = await store.getAll()

  let autoClosed = null
  const stale = all.find(s => !s.closedAt)
  if (stale) {
    stale.closedAt = Date.now()
    stale.closedBy = 'system'
    await store.put(stale)
    autoClosed = stale
  }

  const base = `${config.locationName}-${localDateStr(Date.now())}`
  let id = base
  for (let n = 2; all.some(s => s.id === id); n++) id = `${base}-${n}`

  const shift = {
    id,
    loc: config.locationName,
    cashier: name,
    openedAt: Date.now(),
    closedAt: null,
    closedBy: null,
    receiptCount: 0,
    stornoCount: 0,
    total: 0,
    openingCash: opening, // розмінна готівка на початку зміни
    cashTotal: 0,         // виторг готівкою
    cardTotal: 0,         // виторг карткою
    countedCash: null,    // готівка, порахована касиром при закритті
    expectedCash: null,   // очікувана готівка на момент закриття
  }
  await store.add(shift)
  await tx.done

  return { shift, autoClosed }
}

// countedCash — готівка, яку касир фактично порахував у шухляді при закритті
// (null — перерахунок не проводився, напр. автозакриття системою).
// expectedCash фіксується в записі зміни, щоб Δ можна було відтворити пізніше.
export async function closeShiftLocal(closedBy = 'cashier', countedCash = null) {
  const tx = db().transaction('shifts', 'readwrite')
  const store = tx.objectStore('shifts')
  const open = (await store.getAll()).find(s => !s.closedAt)
  if (!open) {
    await tx.done
    return null
  }
  open.closedAt = Date.now()
  open.closedBy = closedBy
  open.expectedCash = (open.openingCash ?? 0) + (open.cashTotal ?? 0)
  open.countedCash = countedCash === null ? null : Math.round(Number(countedCash) || 0)
  await store.put(open)
  await tx.done
  return open
}

// ── Категорії ──────────────────────────────────────────────

export async function getCategories() {
  const all = await db().getAllFromIndex('categories', 'order')
  return all
}

// ── Товари ─────────────────────────────────────────────────

export async function getProducts(catId) {
  if (catId) {
    return db().getAllFromIndex('products', 'cat', catId)
  }
  return db().getAll('products')
}

export async function searchProducts(query) {
  if (!query || !query.trim()) return getProducts()
  const q = query.trim().toLowerCase()
  const all = await db().getAll('products')
  return all.filter(p => p.name.toLowerCase().includes(q))
}

// Уся грошова математика каси працює в цілих ₴ — ціни округлюються на вході,
// щоб дробове значення з форми чи CSV не рознесло копійки по чеках.
export async function createProduct({ cat, name, price, stock, cost = 0 }) {
  const all = await db().getAll('products')
  const manualIds = all.map(p => p.id).filter(id => id >= MANUAL_ID_START)
  const id = manualIds.length ? Math.max(...manualIds) + 1 : MANUAL_ID_START
  const now = Date.now()
  const product = {
    id, cat, name,
    price: Math.round(Number(price) || 0),
    cost: Math.round(Number(cost) || 0),
    stock: Math.round(Number(stock) || 0),
    updatedAt: now, priceUpdatedAt: now,
  }
  await db().put('products', product)
  return product
}

// priceUpdatedAt — окрема мітка часу лише для ціни/собівартості (на відміну
// від updatedAt, який чіпають і продажі/поставки). sync.js звіряється саме
// з нею, щоб відрізнити «товар просто продавався» від «власник вручну
// підправив ціну» — і не втратити ручну правку при наступному імпорті
// catalog.csv, але й не заблокувати оновлення ціни з файлу для товарів,
// які просто активно продаються.
// Ручна зміна залишку (не через поставку і не через продаж) лишає слід
// у журналі deliveries записом type: 'adjustment' з дельтою — інакше після неї
// неможливо відповісти, звідки взявся чи зник товар.
export async function updateProduct(id, { name, price, stock, cost = 0 }) {
  const tx = db().transaction(['products', 'deliveries'], 'readwrite')
  const prodStore = tx.objectStore('products')
  const product = await prodStore.get(id)
  if (!product) throw new Error(`Товар ${id} не знайдено`)

  const now = Date.now()
  const newStock = Math.round(Number(stock) || 0)
  const updated = {
    ...product, name,
    price: Math.round(Number(price) || 0),
    cost: Math.round(Number(cost) || 0),
    stock: newStock,
    updatedAt: now, priceUpdatedAt: now,
  }
  await prodStore.put(updated)

  const delta = newStock - product.stock
  if (delta !== 0) {
    await tx.objectStore('deliveries').add({
      time: now,
      type: 'adjustment',
      items: [{ id, name: updated.name, qty: delta }],
      note: 'Коригування залишку (Облік товарів)',
    })
  }

  await tx.done
  return updated
}

export async function deleteProduct(id) {
  await db().delete('products', id)
}

// ── Чеки ───────────────────────────────────────────────────

// Продаж можливий лише при відкритій зміні (помилка з code: 'SHIFT_CLOSED').
// receipt.no — внутрішній автоінкрементний ключ (стабільний і унікальний
// назавжди), receipt.shiftNo — людський номер за зміну («М-1», «З-7»),
// який щозміни починається з 1, тому ключем бути не може.
// opts.paymentMethod — з PAYMENT_METHODS (дефолт «готівка»).
// opts.allowOversell — дозволити продаж у мінус (залишок стане від'ємним):
// касир уже підтвердив у UI, що товар фізично є, а облік відстає.
// Без прапорця нестача залишку — помилка з code: 'INSUFFICIENT_STOCK'.
export async function createReceipt(items, discount = 0, opts = {}) {
  const { paymentMethod = 'готівка', allowOversell = false } = opts
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw new Error(`Невірний спосіб оплати: ${PAYMENT_METHODS.map(m => `«${m}»`).join(' або ')}`)
  }

  const tx = db().transaction(['products', 'receipts', 'shifts'], 'readwrite')
  const prodStore = tx.objectStore('products')
  const recStore = tx.objectStore('receipts')
  const shiftStore = tx.objectStore('shifts')

  const shift = (await shiftStore.getAll()).find(s => !s.closedAt)
  if (!shift) {
    const err = new Error('Зміна не відкрита — продаж неможливий')
    err.code = 'SHIFT_CLOSED'
    throw err
  }

  // Перевірка залишків і списання stock
  for (const item of items) {
    const product = await prodStore.get(item.id)
    if (!product) throw new Error(`Товар ${item.id} не знайдено`)
    if (!allowOversell && product.stock < item.qty) {
      const err = new Error(`Недостатньо залишку для "${product.name}": є ${product.stock}, потрібно ${item.qty}`)
      err.code = 'INSUFFICIENT_STOCK'
      throw err
    }
    product.stock -= item.qty
    product.updatedAt = Date.now()
    await prodStore.put(product)
  }

  const { subtotal, total } = calcReceiptTotals(items, discount)

  shift.receiptCount += 1
  shift.total += total
  if (paymentMethod === 'картка') shift.cardTotal = (shift.cardTotal ?? 0) + total
  else shift.cashTotal = (shift.cashTotal ?? 0) + total
  await shiftStore.put(shift)

  const receipt = {
    time: Date.now(),
    loc: shift.loc,
    cashier: shift.cashier,
    shiftId: shift.id,
    // Префікс — перша літера назви точки: «Магазин…» → «М-1»
    shiftNo: `${(shift.loc?.trim()[0] ?? '№').toUpperCase()}-${shift.receiptCount}`,
    items: items.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
    subtotal,
    discount,
    total,
    paymentMethod,
    cancelled: false,
    cancelReason: null,
  }

  const no = await recStore.add(receipt)
  await tx.done

  return { ...receipt, no }
}

// Сторно вимагає причину — без неї чек не скасовується.
export async function cancelReceipt(no, reason) {
  if (!CANCEL_REASONS.includes(reason)) {
    throw new Error(`Вкажіть причину сторно: ${CANCEL_REASONS.map(r => `«${r}»`).join(' або ')}`)
  }

  const tx = db().transaction(['products', 'receipts', 'shifts'], 'readwrite')
  const prodStore = tx.objectStore('products')
  const recStore = tx.objectStore('receipts')
  const shiftStore = tx.objectStore('shifts')

  const receipt = await recStore.get(no)
  if (!receipt) throw new Error(`Чек №${no} не знайдено`)
  if (receipt.cancelled) throw new Error(`Чек №${no} вже скасовано`)

  // Повернення stock
  for (const item of receipt.items) {
    const product = await prodStore.get(item.id)
    if (product) {
      product.stock += item.qty
      product.updatedAt = Date.now()
      await prodStore.put(product)
    }
  }

  receipt.cancelled = true
  receipt.cancelReason = reason
  await recStore.put(receipt)

  // Підсумки зміни чека (навіть уже закритої) відображають сторно.
  // Чеки до впровадження змін не мають shiftId — їх пропускаємо.
  if (receipt.shiftId) {
    const shift = await shiftStore.get(receipt.shiftId)
    if (shift) {
      shift.stornoCount += 1
      shift.total -= receipt.total
      // Розбивка за способом оплати теж має відобразити повернення грошей.
      if ((receipt.paymentMethod ?? 'готівка') === 'картка') {
        shift.cardTotal = (shift.cardTotal ?? 0) - receipt.total
      } else {
        shift.cashTotal = (shift.cashTotal ?? 0) - receipt.total
      }
      await shiftStore.put(shift)
    }
  }

  await tx.done
  return receipt
}

export async function getReceipts(shiftId) {
  const all = await db().getAllFromIndex('receipts', 'time')
  return shiftId ? all.filter(r => r.shiftId === shiftId) : all
}

// ── Поставки (надходження товару) ────────────────────────────
// delivery: { id, time, items: [{id, name, qty}], note }
// Приймання товару — протилежність продажу: лише збільшує stock,
// ніколи не зменшує. Окремий журнал, щоб бачити, звідки взявся залишок.

export async function receiveDelivery(items, note = '') {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Додайте хоча б один товар до поставки')
  }
  for (const item of items) {
    if (!item.qty || item.qty <= 0) {
      throw new Error(`Вкажіть додатну кількість для "${item.name}"`)
    }
  }

  const tx = db().transaction(['products', 'deliveries'], 'readwrite')
  const prodStore = tx.objectStore('products')
  const delStore = tx.objectStore('deliveries')

  for (const item of items) {
    const product = await prodStore.get(item.id)
    if (!product) throw new Error(`Товар ${item.id} не знайдено`)
    product.stock += item.qty
    product.updatedAt = Date.now()
    await prodStore.put(product)
  }

  const delivery = {
    time: Date.now(),
    type: 'delivery', // старі записи без type теж вважаються поставками
    items: items.map(i => ({ id: i.id, name: i.name, qty: i.qty })),
    note: (note ?? '').trim(),
  }
  const id = await delStore.add(delivery)
  await tx.done

  return { ...delivery, id }
}

export async function getDeliveries() {
  return db().getAllFromIndex('deliveries', 'time')
}

// ── Бекап (перенесення бази на інший ПК) ────────────────────

// v3 додає поставки (deliveries); бекапи v1/v2 без них приймаються.
const BACKUP_VERSION = 3

export async function exportBackup() {
  const [categories, products, receipts, shifts, deliveries, config] = await Promise.all([
    db().getAll('categories'),
    db().getAll('products'),
    db().getAll('receipts'),
    db().getAll('shifts'),
    db().getAll('deliveries'),
    getConfig(),
  ])
  return { version: BACKUP_VERSION, exportedAt: Date.now(), categories, products, receipts, shifts, deliveries, config }
}

export async function importBackup(backup) {
  if (!backup || !Array.isArray(backup.categories) || !Array.isArray(backup.products) || !Array.isArray(backup.receipts)) {
    throw new Error('Невірний формат файлу бекапу')
  }
  const shifts = Array.isArray(backup.shifts) ? backup.shifts : []
  const deliveries = Array.isArray(backup.deliveries) ? backup.deliveries : []

  const tx = db().transaction(['categories', 'products', 'receipts', 'shifts', 'deliveries', 'config'], 'readwrite')
  const catStore = tx.objectStore('categories')
  const prodStore = tx.objectStore('products')
  const recStore = tx.objectStore('receipts')
  const shiftStore = tx.objectStore('shifts')
  const delStore = tx.objectStore('deliveries')
  const configStore = tx.objectStore('config')

  await catStore.clear()
  await prodStore.clear()
  await recStore.clear()
  await shiftStore.clear()
  await delStore.clear()

  for (const cat of backup.categories) await catStore.put(cat)
  for (const prod of backup.products) await prodStore.put(prod)
  for (const rec of backup.receipts) await recStore.put(rec)
  for (const shift of shifts) await shiftStore.put(shift)
  for (const del of deliveries) await delStore.put(del)
  // Конфіг точки замінюємо лише якщо він є в бекапі (v1-бекапи його не мають) —
  // інакше відновлення стерло б налаштування каси на цьому пристрої.
  if (backup.config) await configStore.put(backup.config, CONFIG_KEY)

  await tx.done
}

// ── Хелпери для sync.js ────────────────────────────────────

export async function putCategory(cat) {
  await db().put('categories', cat)
}

export async function putProduct(product) {
  await db().put('products', product)
}

// ── Статистика ─────────────────────────────────────────────

function startOfTodayMs() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// Індексований запит замість повного getAll+filter — дешевий незалежно від
// того, наскільки виросла історія чеків за роки роботи каси.
async function getReceiptsSince(sinceMs) {
  return db().getAllFromIndex('receipts', 'time', IDBKeyRange.lowerBound(sinceMs))
}

export async function getDayTotal() {
  const todayReceipts = await getReceiptsSince(startOfTodayMs())
  const active = todayReceipts.filter(r => !r.cancelled)
  return {
    sum: active.reduce((s, r) => s + r.total, 0),
    count: active.length,
  }
}

// Дешева частина статистики — тільки сьогоднішні чеки через індекс. Розрахована
// на часте опитування (напр. кожні кілька секунд, поки відкритий екран).
export async function getTodayStats() {
  const todayReceipts = await getReceiptsSince(startOfTodayMs())
  const active = todayReceipts.filter(r => !r.cancelled)
  const cancelled = todayReceipts.filter(r => r.cancelled)
  const sumBy = (arr, key) => arr.reduce((s, r) => s + r[key], 0)

  return {
    sum: sumBy(active, 'total'),
    count: active.length,
    avgCheck: active.length ? Math.round(sumBy(active, 'total') / active.length) : 0,
    discountTotal: sumBy(active, 'subtotal') - sumBy(active, 'total'),
    cancelledCount: cancelled.length,
  }
}

// Важка частина статистики — повний прохід по товарах і всій історії чеків
// (за весь час, топ-товари). Варто оновлювати рідше за getTodayStats.
export async function getFullStats() {
  const [products, categoryCount, receipts] = await Promise.all([
    db().getAll('products'),
    db().count('categories'),
    db().getAll('receipts'),
  ])

  const active = receipts.filter(r => !r.cancelled)
  const cancelled = receipts.filter(r => r.cancelled)
  const sumBy = (arr, key) => arr.reduce((s, r) => s + r[key], 0)

  const soldQtyById = new Map()
  for (const r of active) {
    for (const item of r.items) {
      soldQtyById.set(item.id, (soldQtyById.get(item.id) ?? 0) + item.qty)
    }
  }
  const topProducts = [...soldQtyById.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, qty]) => ({ id, qty, name: products.find(p => p.id === id)?.name ?? `#${id}` }))

  const valueBySalePrice = products.reduce((s, p) => s + p.price * p.stock, 0)
  const valueByCostPrice = products.reduce((s, p) => s + (p.cost || 0) * p.stock, 0)

  return {
    allTime: {
      sum: sumBy(active, 'total'),
      count: active.length,
      cancelledCount: cancelled.length,
    },
    stock: {
      productsCount: products.length,
      categoriesCount: categoryCount,
      outOfStockCount: products.filter(p => p.stock === 0).length,
      totalUnits: products.reduce((s, p) => s + p.stock, 0),
      valueBySalePrice,
      valueByCostPrice,
      potentialProfit: valueBySalePrice - valueByCostPrice,
    },
    topProducts,
  }
}

// Зручна обгортка для одноразового виклику (наприклад, у тестах) — для частого
// опитування в UI використовуйте getTodayStats()/getFullStats() окремо.
export async function getStats() {
  const [today, rest] = await Promise.all([getTodayStats(), getFullStats()])
  return { today, ...rest }
}
