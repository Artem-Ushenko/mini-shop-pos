/**
 * Міграція WooCommerce → Каталог «Геркулес Шоп»
 *
 * Використання:
 *   node scripts/migrate-woo.mjs path/to/woo-products.csv
 *
 * Вхід:  CSV-експорт WooCommerce (Products → Export), стандартний англомовний
 *        АБО спрощений україномовний (ID, Назва, Запаси, "Звичайна ціна", Категорії)
 * Вихід: public/catalog.csv  ← офіційний файл каталогу каси
 *
 * catalog.csv можна відкрити й відредагувати прямо в Excel (дві секції —
 * категорії й товари). Каса читає цей файл автоматично при кожному запуску
 * зі свого постійного шляху (`/catalog.csv`) — без кнопки імпорту, без мережі.
 *
 * Поля результату відповідають контракту БД каси (паспорт, розділ "product"):
 *   id, cat, name, price, stock, updatedAt
 * Тобто "Назва" з CSV → "name", "Категорії" → "cat", "Звичайна ціна" → "price",
 * "Запаси" → "stock" — назви колонок з експорту НЕ потрапляють у catalog.csv як є.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT   = resolve(__dir, '..')
const INPUT  = process.argv[2] ?? resolve(ROOT, 'woo-export.csv')
const OUTDIR = resolve(ROOT, 'public')

// ── База знань категорій спортхарчу ────────────────────────────────────────────
// Ключове слово (підрядок) → опис категорії
const CAT_RULES = [
  { keys: ['протеїн', 'protein', 'whey', 'казеїн', 'casein', 'ізолят', 'isolate'],
    id: 'protein',     name: 'Протеїни',         emoji: '🥛', order: 1 },
  { keys: ['гейнер', 'gainer', 'mass'],
    id: 'gainer',      name: 'Гейнери',           emoji: '🏋️', order: 2 },
  { keys: ['креатин', 'creatine'],
    id: 'creatine',    name: 'Креатин',            emoji: '⚡', order: 3 },
  { keys: ['аміно', 'amino', 'bcaa', 'глютамін', 'glutamine', 'eaa'],
    id: 'amino',       name: 'Амінокислоти / BCAA', emoji: '🧬', order: 4 },
  { keys: ['передтрен', 'preworkout', 'pre-workout', 'бустер', 'pump'],
    id: 'preworkout',  name: 'Передтренувальні',   emoji: '🔥', order: 5 },
  { keys: ['вітамін', 'vitamin', 'мінерал', 'mineral', 'omega', 'магній', 'цинк', 'zinc'],
    id: 'vitamins',    name: 'Вітаміни / мінерали', emoji: '💊', order: 6 },
  { keys: ['батончик', 'bar ', 'снек', 'snack', 'печиво', 'cookie', 'мюслі'],
    id: 'bars',        name: 'Батончики / снеки',   emoji: '🍫', order: 7 },
  { keys: ['жироспал', 'fat burn', 'l-carnitine', 'карнітин', 'термо'],
    id: 'fatburner',   name: 'Жироспалювачі',       emoji: '🔥', order: 8 },
  { keys: ['аксесуар', 'accessory', 'шейкер', 'shaker', 'рукавиц', 'пояс', 'бинт'],
    id: 'accessories', name: 'Аксесуари',            emoji: '🥤', order: 9 },
  { keys: ['пептид', 'peptide', 'семаглутид', 'тирзепатид', 'ретатрутид'],
    id: 'peptides',    name: 'Пептиди',              emoji: '💉', order: 10 },
  { keys: ['ізотонік', 'isotonic'],
    id: 'isotonic',    name: 'Ізотоніки',            emoji: '🧃', order: 11 },
]

function resolveCat(rawName) {
  const lower = rawName.toLowerCase()
  for (const rule of CAT_RULES) {
    if (rule.keys.some(k => lower.includes(k))) return rule
  }
  return null
}

// Транслітерація для автогенерації id невідомих категорій
const TRANSLIT = { а:'a',б:'b',в:'v',г:'g',ґ:'g',д:'d',е:'e',є:'e',ж:'zh',з:'z',
  и:'y',і:'i',ї:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',
  у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ю:'yu',я:'ya' }

function slugify(str) {
  return str.toLowerCase()
    .split('').map(c => TRANSLIT[c] ?? c).join('')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'other'
}

// ── CSV-парсер (підтримує лапки, BOM, \r\n) ────────────────────────────────────
function parseCSV(text) {
  const src = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text  // видалити BOM (U+FEFF)
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

// Категорії в WooCommerce йдуть як "Кат1, Кат2 > Підкат2, Кат3" — коми всередині
// назви категорії екрануються як "\,". Ділимо тільки на неекрановані коми.
function splitCategories(str) {
  if (!str) return []
  return str.split(/(?<!\\),/).map(s => s.trim().replace(/\\,/g, ',')).filter(Boolean)
}

// З рядка категорій обираємо найінформативніший сегмент:
// перевагу віддаємо тому, що має "Батько > Дитина" (беремо найглибшу дитину).
function pickCategoryLabel(catStr) {
  const segments = splitCategories(catStr)
  if (!segments.length) return ''
  let best = segments.find(s => s.includes('>'))
  if (best) return best.split('>').pop().trim()
  return segments[0]
}

// ── Читання файлу ──────────────────────────────────────────────────────────────
let raw
try {
  raw = readFileSync(INPUT, 'utf-8')
} catch {
  console.error(`\n❌  Файл не знайдено: ${INPUT}`)
  console.error('   Використання: node scripts/migrate-woo.mjs path/to/woo-products.csv\n')
  process.exit(1)
}

const [headerRow, ...dataRows] = parseCSV(raw)

// Індекс колонок (регістронезалежно, з підтримкою укр. заголовків WooCommerce)
const H = {}
headerRow.forEach((h, i) => { H[h.toLowerCase().replace(/[()]/g, '').trim()] = i })

const col = (r, ...names) => {
  for (const n of names) if (H[n] !== undefined) return r[H[n]] ?? ''
  return ''
}

const get = {
  id:       r => col(r, 'id'),
  name:     r => col(r, 'name', 'назва'),
  type:     r => col(r, 'type', 'тип'),
  parent:   r => col(r, 'parent'),
  published: r => col(r, 'published', 'is published', 'post status', 'публікація'),
  stock:    r => col(r, 'stock', 'stock quantity', 'qty', 'запаси', 'кількість'),
  regular:  r => col(r, 'regular price', 'звичайна ціна'),
  sale:     r => col(r, 'sale price', 'акційна ціна'),
  cats:     r => col(r, 'categories', 'category', 'категорії', 'категорія'),
  attr:     (r, i) => col(r, `attribute ${i} value(s)`, `attribute ${i} values`, `attribute_${i}_values`),
}

function toNumber(str) {
  return parseFloat(String(str).replace(',', '.')) || 0
}

function cleanName(str) {
  return str.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
            .replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim()
}

// ── Прохід 1: збираємо батьківські змінні товари (стандартний Woo-експорт) ─────
const parents = {}   // id → name
for (const r of dataRows) {
  if (get.type(r).toLowerCase() === 'variable') parents[get.id(r)] = get.name(r)
}

// ── Прохід 2: розбираємо кожен рядок на { base, suffix } ───────────────────────
// suffix ставиться в двох випадках:
//  а) стандартний Woo-експорт: type === 'variation' → суфікс з колонок attribute N
//  б) спрощений укр. експорт: назва містить "<span> - </span>", розділяємо на
//     базову назву + значення варіації (вага/кількість АБО смак)
const SPAN_RE = /<span[^>]*>\s*-\s*<\/span>/i
const WEIGHT_RE = /\d/  // варіація з цифрою (вага/кількість) — самостійний товар; без цифри — смак, не рахуємо окремим товаром

// Іноді суфікс варіації містить і смак, і вагу одразу ("Яблуко, 300 грам" або
// "300 грам, Яблуко") — беремо лише сегмент з цифрою (вагу/кількість) і
// відкидаємо смак, щоб не плодити по картці на кожен смак в межах однієї ваги.
// Повертає null, якщо цифри нема взагалі (це суто смак — товар не окремий).
function extractWeightToken(suffix) {
  if (!WEIGHT_RE.test(suffix)) return null
  if (!suffix.includes(',')) return suffix
  const segments = suffix.split(',').map(s => s.trim())
  const digitSegs = segments.filter(s => WEIGHT_RE.test(s))
  return digitSegs.length === 1 ? digitSegs[0] : suffix
}

// Якщо в WooCommerce взагалі нема даних про залишок (порожнє поле) — не 0,
// а дефолтне "в наявності", інакше каса заблокує продаж 94% каталогу.
// Якщо залишок вказано явно (навіть 0) — довіряємо джерелу.
const DEFAULT_STOCK_WHEN_UNKNOWN = 20

const parsedRows = []
for (const r of dataRows) {
  const type      = get.type(r).toLowerCase()
  const published = get.published(r)
  if (type === 'variable') continue // це лише "заголовок" групи, ціни не має
  if (published === '0' || published.toLowerCase() === 'draft') continue

  let rawName = get.name(r)
  let base = rawName, suffix = null

  if (type === 'variation') {
    const parentName = parents[get.parent(r)] ?? rawName
    const attrs = []
    for (let a = 1; a <= 8; a++) { const v = get.attr(r, a); if (v) attrs.push(v) }
    base = parentName
    suffix = attrs.length ? attrs.join(' ') : null
  } else if (SPAN_RE.test(rawName)) {
    const [b, s] = rawName.split(SPAN_RE)
    base = b; suffix = (s ?? '').trim() || null
  }

  base = cleanName(base)
  if (suffix) suffix = cleanName(suffix)
  if (!base) continue

  const salePrice = toNumber(get.sale(r))
  const regPrice  = toNumber(get.regular(r))
  const price     = salePrice > 0 ? salePrice : regPrice
  const stockRaw  = get.stock(r).trim()
  const stock     = stockRaw === '' ? DEFAULT_STOCK_WHEN_UNKNOWN : Math.max(0, parseInt(stockRaw) || 0)
  const catStr    = get.cats(r)
  const wooId     = parseInt(get.id(r)) || 0

  parsedRows.push({ wooId, base, suffix, price, stock, catStr })
}

// Довідник "базова назва → рядок категорії" — заповнюється з будь-якого рядка,
// де категорія вказана (переважно "батьківський"/безваріантний рядок).
const catByBase = new Map()
for (const r of parsedRows) if (r.catStr && !catByBase.has(r.base)) catByBase.set(r.base, r.catStr)

// ── Прохід 3: формуємо фінальний список товарів ────────────────────────────────
const catRegistry = new Map()   // catLabel → catObj
const products    = []
let   autoId       = 100_000
const seenFlavorBase = new Set()
const seenWeightKey  = new Set()

// Ці бренди/категорії ніколи не будуть у наявності — виключаємо з каталогу повністю.
const EXCLUDED_BRANDS = [/ostrovit/i]
const EXCLUDED_CATEGORY_IDS = ['peptides']

function isExcludedProduct(base, catStr) {
  if (EXCLUDED_BRANDS.some(re => re.test(base))) return true
  const label = pickCategoryLabel(catStr)
  const catGuess = (label && resolveCat(label)) || resolveCat(base)
  return !!(catGuess && EXCLUDED_CATEGORY_IDS.includes(catGuess.id))
}

// Дрібні "сирі" категорії WooCommerce, які варто об'єднати з ширшою — вручну
// перевірено й підтверджено (див. звіт з переліком категорій).
// Ключ — мітка категорії з CSV у нижньому регістрі, значення — канонічна назва,
// під якою вона має об'єднатись (якщо це відома CAT_RULES-категорія — піде туди;
// якщо ні — об'єднається з іншою автогенерованою категорією з такою ж назвою).
const CATEGORY_ALIASES = {
  'аргінін':                'Амінокислоти / BCAA',
  'цитрулін':                'Амінокислоти / BCAA',
  'бета-аланін':             'Амінокислоти / BCAA',
  'hmb':                     'Амінокислоти / BCAA',
  'гліцин':                  'Амінокислоти / BCAA',
  'таурин':                  'Амінокислоти / BCAA',
  'калій':                   'Вітаміни / мінерали',
  'кальцій':                 'Вітаміни / мінерали',
  'селен':                   'Вітаміни / мінерали',
  'йод':                     'Вітаміни / мінерали',
  'залізо':                  'Вітаміни / мінерали',
  'мідь':                    'Вітаміни / мінерали',
  'гіалуронова кислота':     'Вітаміни / мінерали',
  'для очей':                'Вітаміни / мінерали',
  'для легень':              'Вітаміни / мінерали',
  'для нирок':               'Вітаміни / мінерали',
  'кофеїн':                  'Передтренувальні',
  'антиоксиданти та детокс': "Здоров'я та відновлення",
  'агматин':                 'Амінокислоти / BCAA',
  'колаген':                 "Краса і здоров'я шкіри, нігтів, волосся",
  'біотин':                  "Краса і здоров'я шкіри, нігтів, волосся",
}

function resolveCategory(catStr, nameForKeywords) {
  let label = pickCategoryLabel(catStr)
  if (!label) {
    const guess = resolveCat(nameForKeywords)
    label = guess ? guess.name : 'Інше'
  }

  const alias = CATEGORY_ALIASES[label.toLowerCase()]
  if (alias) label = alias

  const known = resolveCat(label) ?? resolveCat(nameForKeywords)
  const id = known ? known.id : (slugify(label) || `cat-${catRegistry.size + 1}`)

  if (!catRegistry.has(id)) {
    catRegistry.set(id, known ? { ...known } : {
      id, name: label, emoji: '📦', order: CAT_RULES.length + catRegistry.size + 1,
    })
  }
  return catRegistry.get(id)
}

for (const row of parsedRows) {
  const { wooId, base, suffix, price, stock } = row
  const catStr = row.catStr || catByBase.get(base) || ''
  if (isExcludedProduct(base, catStr)) continue

  if (suffix === null) {
    if (!price) continue
    const cat = resolveCategory(catStr, base)
    products.push({ id: wooId > 0 ? wooId : ++autoId, cat: cat.id, name: base, price, stock, updatedAt: 0 })
    continue
  }

  const weightToken = extractWeightToken(suffix)
  if (weightToken !== null) {
    // Вага/кількість міняє суть товару — окрема позиція каталогу.
    // Різні смаки в межах ОДНІЄЇ ваги — не рахуються окремо (беремо перший).
    const key = `${base}::${weightToken}`
    if (seenWeightKey.has(key)) continue
    if (!price) continue
    seenWeightKey.add(key)
    const cat = resolveCategory(catStr, base)
    products.push({ id: wooId > 0 ? wooId : ++autoId, cat: cat.id, name: `${base} - ${weightToken}`, price, stock, updatedAt: 0 })
  } else {
    // Смак — не окрема позиція, одна картка на базову назву
    if (seenFlavorBase.has(base)) continue
    if (!price) continue
    seenFlavorBase.add(base)
    const cat = resolveCategory(catStr, base)
    products.push({ id: wooId > 0 ? wooId : ++autoId, cat: cat.id, name: base, price, stock, updatedAt: 0 })
  }
}

const categories = [...catRegistry.values()].sort((a, b) => a.order - b.order)

// ── Запис результату: catalog.csv — єдиний офіційний файл каталогу ────────────
// Редагується напряму в Excel, каса читає його автоматично зі свого постійного шляху.
mkdirSync(OUTDIR, { recursive: true })

const csvLines = [
  '# Секція категорій — можна редагувати в Excel',
  'id,назва,emoji,порядок',
  ...categories.map(c => `${c.id},"${c.name}",${c.emoji},${c.order}`),
  '',
  '# Секція товарів — можна редагувати в Excel',
  '# Колонка E (собівартість) — використовується в розділі «Статистика»',
  'id,категорія,назва,кількість,собівартість,ціна продажу',
  ...products.map(p =>
    `${p.id},${p.cat},"${p.name.replace(/"/g, '""')}",${p.stock},,${p.price}`
  ),
]
// BOM на початку — інакше Excel на Windows відкриває кирилицю кракозябрами
writeFileSync(resolve(OUTDIR, 'catalog.csv'), '﻿' + csvLines.join('\n'), 'utf-8')
console.log(`\n✓  public/catalog.csv  (${products.length} товарів, ${categories.length} категорій)`)

// Звіт
console.log('\nКатегорії:')
categories.forEach(c => console.log(`   ${c.emoji}  ${c.name.padEnd(24)} (${c.id})`))
console.log(`\nЗагалом товарів: ${products.length}`)
const noStock = products.filter(p => p.stock === 0).length
if (noStock > 0) console.log(`⚠  Без залишку (stock=0): ${noStock} — перевірте WooCommerce`)
console.log()
