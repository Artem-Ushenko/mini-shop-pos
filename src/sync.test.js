import { describe, it, expect, vi, beforeEach } from 'vitest'

// Мокаємо db.js — sync не повинен тягнути реальний IndexedDB
vi.mock('./db.js', () => ({
  getProducts: vi.fn(),
  putCategory: vi.fn(),
  putProduct: vi.fn(),
}))

import * as db from './db.js'
import { parseCatalogCSV, importFromFile } from './sync.js'

// Мокаємо localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = v },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

beforeEach(() => {
  vi.clearAllMocks()
  localStorageMock.clear()
})

const SAMPLE_CSV = [
  '# Секція категорій — можна редагувати в Excel',
  'id,назва,emoji,порядок',
  'protein,"Протеїни",🥛,1',
  'bars,"Батончики",🍫,2',
  '',
  '# Секція товарів — можна редагувати в Excel',
  '# Колонка E (собівартість) — використовується в розділі «Статистика»',
  'id,категорія,назва,кількість,собівартість,ціна продажу',
  '1,protein,"Whey 900г",12,850,1250',
  '2,bars,"Батончик 60г",48,40,65',
].join('\n')

// ── parseCatalogCSV ─────────────────────────────────────────

describe('parseCatalogCSV', () => {
  it('розбирає обидві секції (категорії і товари)', () => {
    const { categories, products } = parseCatalogCSV(SAMPLE_CSV)

    expect(categories).toEqual([
      { id: 'protein', name: 'Протеїни', emoji: '🥛', order: 1 },
      { id: 'bars', name: 'Батончики', emoji: '🍫', order: 2 },
    ])
    expect(products).toEqual([
      { id: 1, cat: 'protein', name: 'Whey 900г', stock: 12, cost: 850, price: 1250 },
      { id: 2, cat: 'bars', name: 'Батончик 60г', stock: 48, cost: 40, price: 65 },
    ])
  })

  it('коректно розбирає назви з комами всередині лапок', () => {
    const csv = SAMPLE_CSV.replace('"Whey 900г"', '"Whey, HS Labs, 900г"')
    const { products } = parseCatalogCSV(csv)
    expect(products[0].name).toBe('Whey, HS Labs, 900г')
  })

  it('повертає порожні масиви, якщо секцій нема', () => {
    const { categories, products } = parseCatalogCSV('якийсь випадковий текст')
    expect(categories).toEqual([])
    expect(products).toEqual([])
  })
})

// ── importFromFile ─────────────────────────────────────────

describe('importFromFile', () => {
  it('імпортує категорії і товари з catalog.csv', async () => {
    db.getProducts.mockResolvedValue([])

    await importFromFile(SAMPLE_CSV)

    expect(db.putCategory).toHaveBeenCalledTimes(2)
    expect(db.putCategory).toHaveBeenCalledWith({ id: 'protein', name: 'Протеїни', emoji: '🥛', order: 1 })

    expect(db.putProduct).toHaveBeenCalledTimes(2)
    expect(db.putProduct).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, cat: 'protein', name: 'Whey 900г', price: 1250, cost: 850, stock: 12 })
    )
  })

  it('зберігає локальний stock якщо продукт змінювався після останнього імпорту', async () => {
    const recentUpdatedAt = Date.now() // після lastImportTime = 0
    db.getProducts.mockResolvedValue([
      { id: 1, cat: 'protein', name: 'Whey 900г', price: 1250, stock: 8, updatedAt: recentUpdatedAt },
    ])

    await importFromFile(SAMPLE_CSV) // товар 1 у файлі має кількість=12

    expect(db.putProduct).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, price: 1250, stock: 8 }) // stock збережено локальний
    )
  })

  it('перезаписує товар якщо локально не змінювався', async () => {
    const oldUpdatedAt = 1000
    localStorage.setItem('lastImportTime', '2000') // lastImportTime > updatedAt

    db.getProducts.mockResolvedValue([
      { id: 1, cat: 'protein', name: 'Whey', price: 1000, stock: 1, updatedAt: oldUpdatedAt },
    ])

    await importFromFile(SAMPLE_CSV)

    expect(db.putProduct).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, price: 1250, stock: 12 })
    )
  })

  it('зберігає lastImportTime після успішного імпорту', async () => {
    db.getProducts.mockResolvedValue([])
    const before = Date.now()

    await importFromFile(SAMPLE_CSV)

    expect(Number(localStorage.getItem('lastImportTime'))).toBeGreaterThanOrEqual(before)
  })

  it('кидає помилку при невірному форматі', async () => {
    await expect(importFromFile('порожній файл без секцій')).rejects.toThrow('Невірний формат')
  })
})
