import { openDB } from 'idb'

const DB_NAME = 'kasa-db'
const DB_VERSION = 1

// Товари, додані вручну через касу, отримують id з цього діапазону —
// щоб ніколи не перетнутись з id з WooCommerce/Google Таблиці.
const MANUAL_ID_START = 900_000

let _db = null

// Тільки для тестів — скидає singleton
export function _resetDB() { _db = null }

export async function initDB() {
  if (_db) return
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
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
    },
  })
}

function db() {
  if (!_db) throw new Error('DB не ініціалізована. Спочатку викличте initDB()')
  return _db
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

export async function createProduct({ cat, name, price, stock }) {
  const all = await db().getAll('products')
  const manualIds = all.map(p => p.id).filter(id => id >= MANUAL_ID_START)
  const id = manualIds.length ? Math.max(...manualIds) + 1 : MANUAL_ID_START
  const product = { id, cat, name, price, stock, updatedAt: Date.now() }
  await db().put('products', product)
  return product
}

export async function updateProduct(id, { name, price, stock }) {
  const product = await db().get('products', id)
  if (!product) throw new Error(`Товар ${id} не знайдено`)
  const updated = { ...product, name, price, stock, updatedAt: Date.now() }
  await db().put('products', updated)
  return updated
}

export async function deleteProduct(id) {
  await db().delete('products', id)
}

// ── Чеки ───────────────────────────────────────────────────

export async function createReceipt(items, discount = 0) {
  const tx = db().transaction(['products', 'receipts'], 'readwrite')
  const prodStore = tx.objectStore('products')
  const recStore = tx.objectStore('receipts')

  // Перевірка залишків і списання stock
  for (const item of items) {
    const product = await prodStore.get(item.id)
    if (!product) throw new Error(`Товар ${item.id} не знайдено`)
    if (product.stock < item.qty) {
      throw new Error(`Недостатньо залишку для "${product.name}": є ${product.stock}, потрібно ${item.qty}`)
    }
    product.stock -= item.qty
    product.updatedAt = Date.now()
    await prodStore.put(product)
  }

  const subtotal = items.reduce((sum, i) => sum + i.price * i.qty, 0)
  const total = Math.round(subtotal * (1 - discount / 100))

  const receipt = {
    time: Date.now(),
    items: items.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
    subtotal,
    discount,
    total,
    cancelled: false,
  }

  const no = await recStore.add(receipt)
  await tx.done

  return { ...receipt, no }
}

export async function cancelReceipt(no) {
  const tx = db().transaction(['products', 'receipts'], 'readwrite')
  const prodStore = tx.objectStore('products')
  const recStore = tx.objectStore('receipts')

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
  await recStore.put(receipt)
  await tx.done

  return receipt
}

export async function getReceipts() {
  return db().getAllFromIndex('receipts', 'time')
}

// ── Бекап (перенесення бази на інший ПК) ────────────────────

const BACKUP_VERSION = 1

export async function exportBackup() {
  const [categories, products, receipts] = await Promise.all([
    db().getAll('categories'),
    db().getAll('products'),
    db().getAll('receipts'),
  ])
  return { version: BACKUP_VERSION, exportedAt: Date.now(), categories, products, receipts }
}

export async function importBackup(backup) {
  if (!backup || !Array.isArray(backup.categories) || !Array.isArray(backup.products) || !Array.isArray(backup.receipts)) {
    throw new Error('Невірний формат файлу бекапу')
  }

  const tx = db().transaction(['categories', 'products', 'receipts'], 'readwrite')
  const catStore = tx.objectStore('categories')
  const prodStore = tx.objectStore('products')
  const recStore = tx.objectStore('receipts')

  await catStore.clear()
  await prodStore.clear()
  await recStore.clear()

  for (const cat of backup.categories) await catStore.put(cat)
  for (const prod of backup.products) await prodStore.put(prod)
  for (const rec of backup.receipts) await recStore.put(rec)

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
