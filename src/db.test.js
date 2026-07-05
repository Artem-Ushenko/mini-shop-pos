import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import {
  _resetDB,
  initDB,
  getCategories,
  getProducts,
  searchProducts,
  createProduct,
  deleteProduct,
  createReceipt,
  cancelReceipt,
  getReceipts,
  getDayTotal,
  getStats,
  getTodayStats,
  getFullStats,
  exportBackup,
  importBackup,
} from './db.js'

beforeEach(async () => {
  _resetDB()
  globalThis.indexedDB = new IDBFactory()
  await initDB()

  // Засіваємо тестові дані
  const db = await openDB('kasa-db', 1)
  const tx = db.transaction(['categories', 'products'], 'readwrite')
  await tx.objectStore('categories').put({ id: 'kava', name: 'Кава', emoji: '☕', order: 1 })
  await tx.objectStore('categories').put({ id: 'yizha', name: 'Їжа', emoji: '🥐', order: 2 })
  await tx.objectStore('products').put({ id: 1, cat: 'kava', name: 'Еспресо', price: 45, stock: 10, updatedAt: Date.now() })
  await tx.objectStore('products').put({ id: 2, cat: 'kava', name: 'Американо', price: 50, stock: 5, updatedAt: Date.now() })
  await tx.done
  db.close()
})

describe('getCategories', () => {
  it('повертає категорії відсортовані за order', async () => {
    const cats = await getCategories()
    expect(cats).toHaveLength(2)
    expect(cats[0].id).toBe('kava')
    expect(cats[1].id).toBe('yizha')
  })
})

describe('getProducts', () => {
  it('повертає всі товари без фільтру', async () => {
    const prods = await getProducts()
    expect(prods).toHaveLength(2)
  })

  it('фільтрує за категорією', async () => {
    const prods = await getProducts('kava')
    expect(prods).toHaveLength(2)
    prods.forEach(p => expect(p.cat).toBe('kava'))
  })
})

describe('createReceipt', () => {
  it('створює чек і списує stock', async () => {
    const items = [{ id: 1, name: 'Еспресо', price: 45, qty: 2 }]
    const receipt = await createReceipt(items, 0)

    expect(receipt.no).toBeDefined()
    expect(receipt.subtotal).toBe(90)
    expect(receipt.total).toBe(90)
    expect(receipt.discount).toBe(0)
    expect(receipt.cancelled).toBe(false)

    const espresso = (await getProducts()).find(p => p.id === 1)
    expect(espresso.stock).toBe(8) // 10 - 2
  })

  it('рахує знижку правильно', async () => {
    const items = [{ id: 1, name: 'Еспресо', price: 45, qty: 2 }]
    const receipt = await createReceipt(items, 10)
    expect(receipt.subtotal).toBe(90)
    expect(receipt.total).toBe(81) // 90 * 0.9
  })

  it('кидає помилку при нестачі залишку', async () => {
    const items = [{ id: 1, name: 'Еспресо', price: 45, qty: 99 }]
    await expect(createReceipt(items)).rejects.toThrow('Недостатньо залишку')
  })

  it('фіксує ціну на момент продажу', async () => {
    const items = [{ id: 1, name: 'Еспресо', price: 45, qty: 1 }]
    const receipt = await createReceipt(items)
    expect(receipt.items[0].price).toBe(45)
  })
})

describe('cancelReceipt', () => {
  it('скасовує чек і повертає stock', async () => {
    const items = [{ id: 1, name: 'Еспресо', price: 45, qty: 3 }]
    const receipt = await createReceipt(items)
    expect((await getProducts()).find(p => p.id === 1).stock).toBe(7)

    const cancelled = await cancelReceipt(receipt.no)
    expect(cancelled.cancelled).toBe(true)
    expect((await getProducts()).find(p => p.id === 1).stock).toBe(10)
  })

  it('не дозволяє скасувати вже скасований чек', async () => {
    const items = [{ id: 1, name: 'Еспресо', price: 45, qty: 1 }]
    const receipt = await createReceipt(items)
    await cancelReceipt(receipt.no)
    await expect(cancelReceipt(receipt.no)).rejects.toThrow('вже скасовано')
  })

  it('кидає помилку для неіснуючого чека', async () => {
    await expect(cancelReceipt(9999)).rejects.toThrow('не знайдено')
  })
})

describe('searchProducts', () => {
  it('знаходить за частковим збігом (регістронезалежно)', async () => {
    const results = await searchProducts('амери')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Американо')
  })

  it('повертає всі товари при порожньому запиті', async () => {
    const results = await searchProducts('')
    expect(results).toHaveLength(2)
  })

  it('повертає порожній масив якщо нічого не знайдено', async () => {
    const results = await searchProducts('протеїн')
    expect(results).toHaveLength(0)
  })
})

describe('createProduct', () => {
  it('додає товар з id з діапазону 900000+', async () => {
    const product = await createProduct({ cat: 'kava', name: 'Латте', price: 60, stock: 5 })
    expect(product.id).toBe(900_000)
    expect((await getProducts())).toHaveLength(3)
  })

  it('видає наступний id по порядку для другого доданого товару', async () => {
    await createProduct({ cat: 'kava', name: 'Латте', price: 60, stock: 5 })
    const second = await createProduct({ cat: 'yizha', name: 'Круасан', price: 35, stock: 8 })
    expect(second.id).toBe(900_001)
  })

  it('не перетинається з існуючими id з WooCommerce/Таблиці', async () => {
    const db = await (await import('idb')).openDB('kasa-db', 1)
    await db.put('products', { id: 950_000, cat: 'kava', name: 'Імпортований', price: 10, stock: 1, updatedAt: Date.now() })
    db.close()

    const product = await createProduct({ cat: 'kava', name: 'Новий', price: 20, stock: 1 })
    expect(product.id).toBe(950_001)
  })
})

describe('deleteProduct', () => {
  it('видаляє товар з бази', async () => {
    await deleteProduct(1)
    const prods = await getProducts()
    expect(prods).toHaveLength(1)
    expect(prods.find(p => p.id === 1)).toBeUndefined()
  })
})

describe('getReceipts', () => {
  it('повертає всі чеки відсортовані за часом', async () => {
    await createReceipt([{ id: 1, name: 'Еспресо', price: 45, qty: 1 }])
    await createReceipt([{ id: 2, name: 'Американо', price: 50, qty: 1 }])
    const receipts = await getReceipts()
    expect(receipts).toHaveLength(2)
    expect(receipts[0].time).toBeLessThanOrEqual(receipts[1].time)
  })
})

describe('getDayTotal', () => {
  it('рахує суму і кількість тільки активних чеків за сьогодні', async () => {
    await createReceipt([{ id: 1, name: 'Еспресо', price: 45, qty: 1 }])    // total 45
    const r2 = await createReceipt([{ id: 2, name: 'Американо', price: 50, qty: 1 }]) // total 50
    await cancelReceipt(r2.no) // скасовуємо — не має рахуватись

    const { sum, count } = await getDayTotal()
    expect(sum).toBe(45)
    expect(count).toBe(1)
  })
})

describe('getStats', () => {
  it('рахує вартість залишку по ціні продажу і по собівартості', async () => {
    // Еспресо: price 45, stock 10; Американо: price 50, stock 5 (без cost — з seed-даних)
    const db = await (await import('idb')).openDB('kasa-db', 1)
    await db.put('products', { id: 1, cat: 'kava', name: 'Еспресо', price: 45, stock: 10, cost: 20, updatedAt: Date.now() })
    await db.put('products', { id: 2, cat: 'kava', name: 'Американо', price: 50, stock: 5, cost: 25, updatedAt: Date.now() })
    db.close()

    const stats = await getStats()
    expect(stats.stock.valueBySalePrice).toBe(45 * 10 + 50 * 5) // 700
    expect(stats.stock.valueByCostPrice).toBe(20 * 10 + 25 * 5) // 325
    expect(stats.stock.potentialProfit).toBe(700 - 325)
    expect(stats.stock.productsCount).toBe(2)
    expect(stats.stock.categoriesCount).toBe(2)
  })

  it('трактує відсутню собівартість як 0', async () => {
    const stats = await getStats() // seed-товари без поля cost
    expect(stats.stock.valueByCostPrice).toBe(0)
    expect(stats.stock.valueBySalePrice).toBe(45 * 10 + 50 * 5)
  })

  it('рахує денну виручку, середній чек і скасовані окремо від усього часу', async () => {
    const r1 = await createReceipt([{ id: 1, name: 'Еспресо', price: 45, qty: 2 }]) // total 90
    await createReceipt([{ id: 2, name: 'Американо', price: 50, qty: 1 }], 10) // total 45
    const r3 = await createReceipt([{ id: 1, name: 'Еспресо', price: 45, qty: 1 }]) // total 45
    await cancelReceipt(r3.no)

    const stats = await getStats()
    expect(stats.today.count).toBe(2) // скасований не рахується
    expect(stats.today.sum).toBe(135)
    expect(stats.today.avgCheck).toBe(68) // round(135/2)
    expect(stats.today.discountTotal).toBe(5) // знижка з другого чека
    expect(stats.today.cancelledCount).toBe(1)
    expect(stats.allTime.count).toBe(2)
    expect(stats.allTime.cancelledCount).toBe(1)
  })

  it('визначає топ-товари за проданою кількістю (без урахування скасованих)', async () => {
    await createReceipt([{ id: 1, name: 'Еспресо', price: 45, qty: 3 }])
    const r2 = await createReceipt([{ id: 2, name: 'Американо', price: 50, qty: 5 }])
    await cancelReceipt(r2.no)
    await createReceipt([{ id: 2, name: 'Американо', price: 50, qty: 1 }])

    const stats = await getStats()
    expect(stats.topProducts[0]).toEqual({ id: 1, qty: 3, name: 'Еспресо' })
    expect(stats.topProducts[1]).toEqual({ id: 2, qty: 1, name: 'Американо' })
  })

  it('getTodayStats() і getFullStats() окремо дають ту саму картину, що й getStats()', async () => {
    await createReceipt([{ id: 1, name: 'Еспресо', price: 45, qty: 2 }]) // total 90
    const r2 = await createReceipt([{ id: 2, name: 'Американо', price: 50, qty: 1 }])
    await cancelReceipt(r2.no)

    const today = await getTodayStats()
    const full = await getFullStats()

    expect(today).toEqual({ sum: 90, count: 1, avgCheck: 90, discountTotal: 0, cancelledCount: 1 })
    expect(full.allTime).toEqual({ sum: 90, count: 1, cancelledCount: 1 })
    expect(full.stock.productsCount).toBe(2)
    expect(full.topProducts[0]).toEqual({ id: 1, qty: 2, name: 'Еспресо' })

    const combined = await getStats()
    expect(combined).toEqual({ today, ...full })
  })
})

describe('exportBackup / importBackup', () => {
  it('експортує категорії, товари і чеки одним об’єктом', async () => {
    await createReceipt([{ id: 1, name: 'Еспресо', price: 45, qty: 1 }])

    const backup = await exportBackup()
    expect(backup.version).toBe(1)
    expect(backup.exportedAt).toBeGreaterThan(0)
    expect(backup.categories).toHaveLength(2)
    expect(backup.products).toHaveLength(2)
    expect(backup.receipts).toHaveLength(1)
  })

  it('відновлює базу з бекапу, повністю замінюючи поточні дані', async () => {
    await createReceipt([{ id: 1, name: 'Еспресо', price: 45, qty: 3 }]) // stock 10 → 7
    const backup = await exportBackup()

    // Змінюємо стан після бекапу — нове замовлення і новий товар
    await createReceipt([{ id: 2, name: 'Американо', price: 50, qty: 1 }])
    await createProduct({ cat: 'kava', name: 'Латте', price: 60, stock: 5 })

    await importBackup(backup)

    const products = await getProducts()
    expect(products).toHaveLength(2) // «Латте» зникло — бекап замінив базу повністю
    expect(products.find(p => p.id === 1).stock).toBe(7) // стан саме на момент бекапу

    const receipts = await getReceipts()
    expect(receipts).toHaveLength(1) // другий чек зник разом з рештою

    const cats = await getCategories()
    expect(cats).toHaveLength(2)
  })

  it('зберігає номери чеків і продовжує нумерацію після відновлення', async () => {
    const r1 = await createReceipt([{ id: 1, name: 'Еспресо', price: 45, qty: 1 }])
    const backup = await exportBackup()

    await importBackup(backup)

    const r2 = await createReceipt([{ id: 1, name: 'Еспресо', price: 45, qty: 1 }])
    expect(r2.no).toBeGreaterThan(r1.no)
  })

  it('кидає помилку при невірному форматі файлу', async () => {
    await expect(importBackup({ foo: 'bar' })).rejects.toThrow('Невірний формат')
    await expect(importBackup(null)).rejects.toThrow('Невірний формат')
  })
})
