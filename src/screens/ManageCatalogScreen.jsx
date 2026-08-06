import { useState, useEffect, useMemo } from 'react'
import { getCategories, getProducts, createProduct, updateProduct, deleteProduct, createCategory, updateCategory, deleteCategory } from '../db.js'

const PAGE_SIZE = 30

// Залишок ≤ цього числа — товар в списку "Пора замовляти" (той самий поріг,
// що планувався для Telegram-дайджесту в v6-специфікації).
const LOW_STOCK_THRESHOLD = 3

export default function ManageCatalogScreen({ onBack }) {
  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [availFilter, setAvailFilter] = useState('all') // 'all' | 'in' | 'out' | 'low'
  const [sortBy, setSortBy] = useState('default') // 'default' | 'brand'
  const [confirmingId, setConfirmingId] = useState(null)
  const [error, setError] = useState(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState({ cat: '', name: '', price: '', cost: '', stock: '', brand: '' })

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', price: '', cost: '', stock: '', brand: '' })
  const [editError, setEditError] = useState(null)

  const [showCategories, setShowCategories] = useState(false)
  const [editingCatId, setEditingCatId] = useState(null)
  const [editCatName, setEditCatName] = useState('')
  const [catError, setCatError] = useState(null)
  const [confirmingCatId, setConfirmingCatId] = useState(null)
  const [newCatForm, setNewCatForm] = useState({ name: '', emoji: '' })

  async function load() {
    const [cats, prods] = await Promise.all([getCategories(), getProducts()])
    setCategories(cats)
    setProducts(prods)
    setForm(f => ({ ...f, cat: f.cat || cats[0]?.id || '' }))
  }

  useEffect(() => { load() }, [])
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [search, catFilter, brandFilter, availFilter, sortBy])

  const catName = (id) => categories.find(c => c.id === id)?.name ?? id

  // Бренд — опційне поле лише для товарів, доданих/відредагованих вручну
  // (WooCommerce-експорт бренду не дає, див. sync.js) — тому список брендів
  // будується з того, що вже проставлено, а не з фіксованого довідника.
  const brands = useMemo(() => {
    const set = new Set(products.map(p => p.brand).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b, 'uk'))
  }, [products])

  const displayed = useMemo(() => {
    let result = products
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(p => p.name.toLowerCase().includes(q))
    }
    if (catFilter) result = result.filter(p => p.cat === catFilter)
    if (brandFilter) result = result.filter(p => p.brand === brandFilter)
    if (availFilter === 'in') result = result.filter(p => p.stock > 0)
    else if (availFilter === 'out') result = result.filter(p => p.stock <= 0)
    else if (availFilter === 'low') {
      // Найтерміновіші (менший залишок) — зверху списку.
      result = result.filter(p => p.stock <= LOW_STOCK_THRESHOLD).sort((a, b) => a.stock - b.stock)
    }
    if (sortBy === 'brand') {
      // Товари без бренду — в кінець, а не впереміш з початком абетки.
      result = [...result].sort((a, b) => {
        if (!a.brand && !b.brand) return a.name.localeCompare(b.name, 'uk')
        if (!a.brand) return 1
        if (!b.brand) return -1
        return a.brand.localeCompare(b.brand, 'uk') || a.name.localeCompare(b.name, 'uk')
      })
    }
    return result
  }, [products, search, catFilter, brandFilter, availFilter, sortBy])

  const visible = displayed.slice(0, visibleCount)
  const hasMore = visibleCount < displayed.length

  async function handleAdd(e) {
    e.preventDefault()
    setError(null)

    const name = form.name.trim()
    const price = Number(form.price)
    const cost = form.cost === '' ? 0 : Number(form.cost)
    const stock = form.stock === '' ? 0 : Number(form.stock)

    if (!form.cat) return setError('Оберіть категорію')
    if (!name) return setError('Вкажіть назву товару')
    if (!price || price <= 0) return setError('Вкажіть коректну ціну')
    if (cost < 0 || !Number.isFinite(cost)) return setError('Вкажіть коректну собівартість')
    if (stock < 0 || !Number.isFinite(stock)) return setError('Вкажіть коректний залишок')

    try {
      await createProduct({ cat: form.cat, name, price, cost, stock, brand: form.brand })
      setForm(f => ({ ...f, name: '', price: '', cost: '', stock: '', brand: '' }))
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    setError(null)
    try {
      await deleteProduct(id)
      setConfirmingId(null)
      await load()
    } catch (err) {
      setError(err.message)
      setConfirmingId(null)
    }
  }

  function startEdit(p) {
    setEditingId(p.id)
    setEditForm({ name: p.name, price: String(p.price), cost: String(p.cost ?? 0), stock: String(p.stock), brand: p.brand ?? '' })
    setEditError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditError(null)
  }

  async function handleSaveEdit(id) {
    setEditError(null)

    const name = editForm.name.trim()
    const price = Number(editForm.price)
    const cost = editForm.cost === '' ? 0 : Number(editForm.cost)
    const stock = Number(editForm.stock)

    if (!name) return setEditError('Вкажіть назву товару')
    if (!price || price <= 0) return setEditError('Вкажіть коректну ціну')
    if (cost < 0 || !Number.isFinite(cost)) return setEditError('Вкажіть коректну собівартість')
    if (stock < 0 || !Number.isFinite(stock)) return setEditError('Вкажіть коректний залишок')

    try {
      await updateProduct(id, { name, price, cost, stock, brand: editForm.brand })
      setEditingId(null)
      await load()
    } catch (err) {
      setEditError(err.message)
    }
  }

  async function handleAddCat(e) {
    e.preventDefault()
    setCatError(null)
    try {
      await createCategory({ name: newCatForm.name, emoji: newCatForm.emoji })
      setNewCatForm({ name: '', emoji: '' })
      await load()
    } catch (err) {
      setCatError(err.message)
    }
  }

  function startEditCat(c) {
    setEditingCatId(c.id)
    setEditCatName(c.name)
    setCatError(null)
  }

  function cancelEditCat() {
    setEditingCatId(null)
    setCatError(null)
  }

  async function handleSaveCat(id) {
    setCatError(null)
    try {
      await updateCategory(id, { name: editCatName })
      setEditingCatId(null)
      await load()
    } catch (err) {
      setCatError(err.message)
    }
  }

  async function handleDeleteCat(id) {
    setCatError(null)
    try {
      await deleteCategory(id)
      setConfirmingCatId(null)
      await load()
    } catch (err) {
      setCatError(err.message)
      setConfirmingCatId(null)
    }
  }

  return (
    <div className="manage-layout">

      <header className="app-header">
        <button className="btn-ghost" onClick={onBack}>← Назад</button>
        <h1>ГЕРКУЛЕС ШОП · Облік товарів</h1>
        <div style={{ width: 80 }} />
      </header>

      <div className="manage-toolbar">
        <div className="search-bar">
          <input
            type="search"
            placeholder="Пошук товару…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="manage-filters">
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="">Всі категорії</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
            ))}
          </select>
          <select value={availFilter} onChange={e => setAvailFilter(e.target.value)}>
            <option value="all">Всі товари</option>
            <option value="in">В наявності</option>
            <option value="out">Немає в наявності</option>
            <option value="low">Пора замовляти (≤{LOW_STOCK_THRESHOLD} шт)</option>
          </select>
          {brands.length > 0 && (
            <>
              <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
                <option value="">Всі бренди</option>
                {brands.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                <option value="default">Порядок за замовчуванням</option>
                <option value="brand">Сортувати за брендом</option>
              </select>
            </>
          )}
        </div>
        <button className="btn-ghost manage-toggle-add" onClick={() => setShowCategories(s => !s)}>
          {showCategories ? '− Приховати категорії' : '📂 Категорії'}
        </button>
        <button className="btn-ghost manage-toggle-add" onClick={() => setShowAddForm(s => !s)}>
          {showAddForm ? '− Приховати форму' : '+ Додати товар'}
        </button>
      </div>

      <div className="manage-body">

        {showCategories && (
          <div className="manage-add-form card">
            <form className="manage-form-row manage-form-row-split" onSubmit={handleAddCat}>
              <input
                type="text"
                placeholder="Емодзі"
                maxLength={2}
                style={{ maxWidth: 70, flex: '0 0 auto' }}
                value={newCatForm.emoji}
                onChange={e => setNewCatForm(f => ({ ...f, emoji: e.target.value }))}
              />
              <input
                type="text"
                placeholder="Назва нової категорії"
                value={newCatForm.name}
                onChange={e => setNewCatForm(f => ({ ...f, name: e.target.value }))}
              />
              <button type="submit" className="btn-primary">+ Додати</button>
            </form>

            {catError && <p className="error-msg">{catError}</p>}

            {categories.length === 0
              ? <p className="empty-hint">Категорій ще немає — додайте першу вище</p>
              : (
                <ul className="manage-list">
                  {categories.map(c => (
                    <li key={c.id} className="manage-item">
                      {editingCatId === c.id ? (
                        <div className="manage-edit-form">
                          <div className="manage-form-row">
                            <input
                              type="text"
                              placeholder="Назва категорії"
                              value={editCatName}
                              onChange={e => setEditCatName(e.target.value)}
                            />
                          </div>
                          <div className="manage-edit-actions">
                            <button className="btn-primary" onClick={() => handleSaveCat(c.id)}>Зберегти</button>
                            <button className="btn-ghost-sm" onClick={cancelEditCat}>Скасувати</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="manage-item-info">
                            <span className="manage-item-name">{c.emoji} {c.name}</span>
                          </div>

                          {confirmingCatId !== c.id ? (
                            <div className="manage-item-actions">
                              <button className="btn-ghost-sm" onClick={() => startEditCat(c)}>
                                Перейменувати
                              </button>
                              <button
                                className="btn-ghost-sm"
                                style={{ color: 'var(--c-danger)' }}
                                onClick={() => setConfirmingCatId(c.id)}
                              >
                                Видалити
                              </button>
                            </div>
                          ) : (
                            <div className="cancel-confirm">
                              <span>Видалити «{c.name}»?</span>
                              <button className="btn-danger" style={{ minHeight: 36, padding: '6px 14px' }} onClick={() => handleDeleteCat(c.id)}>
                                Так
                              </button>
                              <button className="btn-ghost-sm" onClick={() => setConfirmingCatId(null)}>
                                Ні
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
          </div>
        )}

        {showAddForm && (
          <form className="manage-add-form card" onSubmit={handleAdd}>
            <div className="manage-form-row">
              <select
                value={form.cat}
                onChange={e => setForm(f => ({ ...f, cat: e.target.value }))}
              >
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                ))}
              </select>
            </div>

            <div className="manage-form-row">
              <input
                type="text"
                placeholder="Назва товару"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="manage-form-row">
              <input
                type="text"
                placeholder="Бренд (необов'язково)"
                value={form.brand}
                onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
              />
            </div>

            <div className="manage-form-row manage-form-row-split">
              <input
                type="number"
                min="0"
                step="1"
                placeholder="Ціна, ₴"
                value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
              />
              <input
                type="number"
                min="0"
                step="1"
                placeholder="Собівартість, ₴"
                value={form.cost}
                onChange={e => setForm(f => ({ ...f, cost: e.target.value }))}
              />
              <input
                type="number"
                min="0"
                step="1"
                placeholder="Залишок, шт"
                value={form.stock}
                onChange={e => setForm(f => ({ ...f, stock: e.target.value }))}
              />
            </div>

            {error && <p className="error-msg">{error}</p>}

            <button type="submit" className="btn-primary btn-full">Додати товар</button>
          </form>
        )}

        {visible.length === 0
          ? <p className="empty-hint">Товарів не знайдено</p>
          : (
            <ul className="manage-list">
              {visible.map(p => (
                <li key={p.id} className="manage-item card">
                  {editingId === p.id ? (
                    <div className="manage-edit-form">
                      <div className="manage-form-row">
                        <input
                          type="text"
                          placeholder="Назва товару"
                          value={editForm.name}
                          onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        />
                      </div>
                      <div className="manage-form-row">
                        <input
                          type="text"
                          placeholder="Бренд (необов'язково)"
                          value={editForm.brand}
                          onChange={e => setEditForm(f => ({ ...f, brand: e.target.value }))}
                        />
                      </div>
                      <div className="manage-form-row manage-form-row-split">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="Ціна, ₴"
                          value={editForm.price}
                          onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))}
                        />
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="Собівартість, ₴"
                          value={editForm.cost}
                          onChange={e => setEditForm(f => ({ ...f, cost: e.target.value }))}
                        />
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="Залишок, шт"
                          value={editForm.stock}
                          onChange={e => setEditForm(f => ({ ...f, stock: e.target.value }))}
                        />
                      </div>
                      {editError && <p className="error-msg">{editError}</p>}
                      <div className="manage-edit-actions">
                        <button className="btn-primary" onClick={() => handleSaveEdit(p.id)}>Зберегти</button>
                        <button className="btn-ghost-sm" onClick={cancelEdit}>Скасувати</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="manage-item-info">
                        <span className="manage-item-name">
                          {p.brand && <span className="brand-tag">{p.brand}</span>}
                          {p.name}
                        </span>
                        <span className="manage-item-meta">
                          {catName(p.cat)} · Ціна: {p.price.toLocaleString('uk-UA')} ₴ · Соб.: {(p.cost ?? 0).toLocaleString('uk-UA')} ₴ · {p.stock} шт
                        </span>
                      </div>

                      {confirmingId !== p.id ? (
                        <div className="manage-item-actions">
                          <button className="btn-ghost-sm" onClick={() => startEdit(p)}>
                            Редагувати
                          </button>
                          <button
                            className="btn-ghost-sm"
                            style={{ color: 'var(--c-danger)' }}
                            onClick={() => setConfirmingId(p.id)}
                          >
                            Видалити
                          </button>
                        </div>
                      ) : (
                        <div className="cancel-confirm">
                          <span>Видалити «{p.name}»?</span>
                          <button className="btn-danger" style={{ minHeight: 36, padding: '6px 14px' }} onClick={() => handleDelete(p.id)}>
                            Так
                          </button>
                          <button className="btn-ghost-sm" onClick={() => setConfirmingId(null)}>
                            Ні
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )
        }

        {hasMore && (
          <button className="btn-ghost manage-load-more" onClick={() => setVisibleCount(c => c + PAGE_SIZE)}>
            Показати ще ({displayed.length - visible.length})
          </button>
        )}

      </div>
    </div>
  )
}
