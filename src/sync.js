import { getProducts, putCategory, putProduct } from './db.js'

// ── CSV-парсер (підтримує лапки, BOM, \r\n) ────────────────────────────────
function parseCSV(text) {
  const src = text.replace(/^﻿/, '')
  const rows = []
  let row = [], field = '', inQ = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1]
    if (inQ) {
      if (c === '"' && n === '"') { field += '"'; i++ }
      else if (c === '"') inQ = false
      else field += c
    } else {
      if      (c === '"')                   inQ = true
      else if (c === ',')                   { row.push(field.trim()); field = '' }
      else if (c === '\n' || c === '\r')    {
        row.push(field.trim()); field = ''
        if (row.some(Boolean)) rows.push(row)
        row = []
        if (c === '\r' && n === '\n') i++
      } else field += c
    }
  }
  if (field || row.length) { row.push(field.trim()); if (row.some(Boolean)) rows.push(row) }
  return rows
}

// ── Розбір каталогу catalog.csv (той самий файл, що редагується в Excel) ───
// Формат: дві секції з заголовками, розділені коментарем/порожнім рядком —
// саме так, як їх генерує scripts/migrate-woo.mjs.
// Колонка E (собівартість) читається в поле product.cost — використовується
// в розділі «Статистика» для оцінки вартості залишку.
const CATEGORY_HEADER = 'id,назва,emoji,порядок'
const PRODUCT_HEADER  = 'id,категорія,назва,кількість,собівартість,ціна продажу'

function extractBlock(lines, headerPrefix, nextHeaderPrefix) {
  const startIdx = lines.findIndex(l => l.trim().startsWith(headerPrefix))
  if (startIdx === -1) return []
  let endIdx = lines.length
  if (nextHeaderPrefix) {
    const rel = lines.slice(startIdx + 1).findIndex(l => l.trim().startsWith(nextHeaderPrefix))
    if (rel !== -1) endIdx = startIdx + 1 + rel
  }
  return lines.slice(startIdx, endIdx).filter(l => l.trim() && !l.trim().startsWith('#'))
}

export function parseCatalogCSV(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)

  const catLines  = extractBlock(lines, CATEGORY_HEADER, PRODUCT_HEADER)
  const prodLines = extractBlock(lines, PRODUCT_HEADER, null)

  const catRows  = catLines.length  ? parseCSV(catLines.join('\n')).slice(1)  : []
  const prodRows = prodLines.length ? parseCSV(prodLines.join('\n')).slice(1) : []

  const categories = catRows.map(r => ({ id: r[0], name: r[1], emoji: r[2], order: Number(r[3]) }))
  const products   = prodRows.map(r => ({
    id: Number(r[0]), cat: r[1], name: r[2],
    stock: Number(r[3]) || 0, cost: Number(r[4]) || 0, price: Number(r[5]) || 0,
  }))

  return { categories, products }
}

// ── importFromFile ─────────────────────────────────────────
// Імпортує каталог з локального CSV-файлу (catalog.csv), який власник
// редагує напряму в Excel — без Google Sheets і без мережі.

export async function importFromFile(csvText) {
  const { categories, products } = parseCatalogCSV(csvText)
  if (!categories.length && !products.length) {
    throw new Error('Невірний формат: очікується CSV з секціями категорій і товарів (див. catalog.csv)')
  }

  const lastImportTime = Number(localStorage.getItem('lastImportTime') ?? 0)

  for (const cat of categories) await putCategory(cat)

  const existing = await getProducts()
  const localMap = new Map(existing.map(p => [p.id, p]))

  for (const csvProduct of products) {
    const local = localMap.get(csvProduct.id)

    if (!local) {
      // Новий товар — беремо все з файлу
      await putProduct({ ...csvProduct, updatedAt: Date.now() })
    } else if (local.updatedAt > lastImportTime) {
      // Локально змінено після останнього імпорту (були продажі) — зберігаємо stock
      await putProduct({ ...csvProduct, stock: local.stock, updatedAt: local.updatedAt })
    } else {
      // Не змінювався локально — повністю перезаписуємо
      await putProduct({ ...csvProduct, updatedAt: Date.now() })
    }
  }

  localStorage.setItem('lastImportTime', String(Date.now()))
}
