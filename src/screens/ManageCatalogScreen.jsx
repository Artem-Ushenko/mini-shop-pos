import { useState, useEffect, useMemo } from 'react'
import { getCategories, getProducts, createProduct, updateProduct, deleteProduct } from '../db.js'

const PAGE_SIZE = 30

export default function ManageCatalogScreen({ onBack }) {
  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [confirmingId, setConfirmingId] = useState(null)
  const [error, setError] = useState(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState({ cat: '', name: '', price: '', cost: '', stock: '' })

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', price: '', cost: '', stock: '' })
  const [editError, setEditError] = useState(null)

  async function load() {
    const [cats, prods] = await Promise.all([getCategories(), getProducts()])
    setCategories(cats)
    setProducts(prods)
    setForm(f => ({ ...f, cat: f.cat || cats[0]?.id || '' }))
  }

  useEffect(() => { load() }, [])
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [search])

  const catName = (id) => categories.find(c => c.id === id)?.name ?? id

  const displayed = useMemo(() => {
    if (!search.trim()) return products
    const q = search.trim().toLowerCase()
    return products.filter(p => p.name.toLowerCase().includes(q))
  }, [products, search])

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
      await createProduct({ cat: form.cat, name, price, cost, stock })
      setForm(f => ({ ...f, name: '', price: '', cost: '', stock: '' }))
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
    setEditForm({ name: p.name, price: String(p.price), cost: String(p.cost ?? 0), stock: String(p.stock) })
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
      await updateProduct(id, { name, price, cost, stock })
      setEditingId(null)
      await load()
    } catch (err) {
      setEditError(err.message)
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
        <button className="btn-ghost manage-toggle-add" onClick={() => setShowAddForm(s => !s)}>
          {showAddForm ? '− Приховати форму' : '+ Додати товар'}
        </button>
      </div>

      <div className="manage-body">

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
                        <span className="manage-item-name">{p.name}</span>
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
