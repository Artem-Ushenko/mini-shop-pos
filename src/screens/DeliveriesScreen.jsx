import { useState, useEffect, useMemo } from 'react'
import { getProducts, getCategories, createProduct, receiveDelivery, getDeliveries } from '../db.js'

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(ts) {
  const d = new Date(ts)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function dayKey(ts) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// Групує поставки (вже відсортовані від найновіших) за днем, як у Журналі чеків.
function groupByDay(deliveries) {
  const todayKey = dayKey(Date.now())
  const groups = []
  for (const d of deliveries) {
    const key = dayKey(d.time)
    const label = key === todayKey ? 'Сьогодні' : fmtDate(d.time)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(d)
    else groups.push({ key, label, items: [d] })
  }
  return groups
}

export default function DeliveriesScreen({ onBack }) {
  const [mode, setMode] = useState('receive') // 'receive' | 'journal'
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState([]) // [{id, name, qty}]
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState(null)
  const [deliveries, setDeliveries] = useState([])
  const [categories, setCategories] = useState([])
  const [showNewForm, setShowNewForm] = useState(false)
  const [newForm, setNewForm] = useState({ cat: '', name: '', price: '', cost: '' })
  const [newError, setNewError] = useState(null)

  async function loadProducts() {
    setProducts(await getProducts())
  }

  async function loadDeliveries() {
    setDeliveries([...(await getDeliveries())].reverse()) // найновіші зверху
  }

  useEffect(() => { loadProducts() }, [])
  useEffect(() => { getCategories().then(setCategories) }, [])
  useEffect(() => { if (mode === 'journal') loadDeliveries() }, [mode])

  const displayed = useMemo(() => {
    if (!search.trim()) return []
    const q = search.trim().toLowerCase()
    return products.filter(p => p.name.toLowerCase().includes(q)).slice(0, 30)
  }, [products, search])

  function addToPending(product) {
    setSuccessMsg(null)
    setPending(prev => {
      const exists = prev.find(i => i.id === product.id)
      if (exists) return prev.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { id: product.id, name: product.name, qty: 1 }]
    })
  }

  function openNewForm() {
    setNewForm(f => ({ ...f, name: f.name || search.trim() }))
    setNewError(null)
    setShowNewForm(true)
  }

  // Створює товар у БД і одразу кладе його в кошик поставки.
  // stock: 0 — кількість оприбуткує сама поставка, інакше залишок подвоївся б.
  async function handleCreateProduct(e) {
    e.preventDefault()
    setNewError(null)

    const name = newForm.name.trim()
    const price = Number(newForm.price)
    const cost = newForm.cost === '' ? 0 : Number(newForm.cost)

    if (!newForm.cat) return setNewError('Оберіть категорію')
    if (!name) return setNewError('Вкажіть назву товару')
    if (!price || price <= 0) return setNewError('Вкажіть коректну ціну')
    if (cost < 0 || !Number.isFinite(cost)) return setNewError('Вкажіть коректну собівартість')

    const existing = products.find(p => p.name.trim().toLowerCase() === name.toLowerCase())
    if (existing) return setNewError('Такий товар вже є в базі — знайдіть його через пошук вище')

    try {
      const product = await createProduct({ cat: newForm.cat, name, price, cost, stock: 0 })
      addToPending(product)
      setNewForm(f => ({ ...f, name: '', price: '', cost: '' }))
      setShowNewForm(false)
      setSearch('')
      await loadProducts()
    } catch (err) {
      setNewError(err.message)
    }
  }

  function updateQty(id, delta) {
    setPending(prev => {
      const item = prev.find(i => i.id === id)
      if (!item) return prev
      const newQty = item.qty + delta
      if (newQty <= 0) return prev.filter(i => i.id !== id)
      return prev.map(i => i.id === id ? { ...i, qty: newQty } : i)
    })
  }

  async function handleReceive() {
    setError(null)
    setSuccessMsg(null)
    setSaving(true)
    try {
      await receiveDelivery(pending, note)
      setPending([])
      setNote('')
      setSuccessMsg('Поставку оприбутковано')
      await loadProducts()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="manage-layout">

      <header className="app-header">
        <button className="btn-ghost" onClick={onBack}>← Назад</button>
        <h1>ГЕРКУЛЕС ШОП · Поставки</h1>
        <div style={{ width: 80 }} />
      </header>

      <div className="category-tabs" style={{ padding: '10px 16px 0' }}>
        <button
          className={`tab${mode === 'receive' ? ' active' : ''}`}
          onClick={() => setMode('receive')}
        >
          Прийняти товар
        </button>
        <button
          className={`tab${mode === 'journal' ? ' active' : ''}`}
          onClick={() => setMode('journal')}
        >
          Журнал поставок
        </button>
      </div>

      {mode === 'receive' && (
        <div className="manage-body manage-body-narrow">

          <div className="search-bar">
            <input
              type="search"
              placeholder="Пошук товару…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <button
            className="btn-ghost"
            onClick={() => showNewForm ? setShowNewForm(false) : openNewForm()}
          >
            {showNewForm ? '− Приховати форму' : '+ Новий товар'}
          </button>

          {showNewForm && (
            <form className="manage-add-form card" onSubmit={handleCreateProduct}>
              <div className="manage-form-row">
                <select
                  value={newForm.cat}
                  onChange={e => setNewForm(f => ({ ...f, cat: e.target.value }))}
                >
                  <option value="">Категорія…</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
                  ))}
                </select>
              </div>

              <div className="manage-form-row">
                <input
                  type="text"
                  placeholder="Назва товару"
                  value={newForm.name}
                  onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div className="manage-form-row manage-form-row-split">
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Ціна, ₴"
                  value={newForm.price}
                  onChange={e => setNewForm(f => ({ ...f, price: e.target.value }))}
                />
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Собівартість, ₴"
                  value={newForm.cost}
                  onChange={e => setNewForm(f => ({ ...f, cost: e.target.value }))}
                />
              </div>

              {newError && <p className="error-msg">{newError}</p>}

              <button type="submit" className="btn-primary btn-full">Створити і додати в поставку</button>
            </form>
          )}

          {search.trim() && !showNewForm && (
            displayed.length === 0
              ? (
                <div>
                  <p className="empty-hint">Нічого не знайдено</p>
                  <button className="btn-ghost" onClick={openNewForm}>
                    + Створити товар «{search.trim()}»
                  </button>
                </div>
              )
              : (
                <ul className="manage-list">
                  {displayed.map(p => (
                    <li key={p.id} className="manage-item card">
                      <div className="manage-item-info">
                        <span className="manage-item-name">{p.name}</span>
                        <span className="manage-item-meta">Поточний залишок: {p.stock} шт</span>
                      </div>
                      <button className="btn-ghost-sm" onClick={() => addToPending(p)}>+ Додати</button>
                    </li>
                  ))}
                </ul>
              )
          )}

          {pending.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ marginBottom: 10 }}>Поставка</h3>
              <ul className="cart-list">
                {pending.map(item => (
                  <li key={item.id} className="cart-item">
                    <div className="cart-item-top">
                      <span className="cart-item-name">{item.name}</span>
                    </div>
                    <div className="cart-item-controls">
                      <button className="qty-btn" onClick={() => updateQty(item.id, -1)}>−</button>
                      <span className="qty-value">{item.qty}</span>
                      <button className="qty-btn" onClick={() => updateQty(item.id, +1)}>+</button>
                      <button
                        className="remove-btn"
                        onClick={() => setPending(prev => prev.filter(i => i.id !== item.id))}
                        title="Прибрати"
                      >✕</button>
                    </div>
                  </li>
                ))}
              </ul>

              <input
                type="text"
                placeholder="Примітка (накладна, постачальник)…"
                value={note}
                onChange={e => setNote(e.target.value)}
                style={{ marginTop: 12, width: '100%' }}
              />

              {error && <p className="error-msg" style={{ marginTop: 12 }}>{error}</p>}

              <button
                className="btn-primary btn-full"
                style={{ marginTop: 12 }}
                disabled={saving}
                onClick={handleReceive}
              >
                {saving ? 'Оприбуткування…' : 'Оприбуткувати поставку'}
              </button>
            </div>
          )}

          {successMsg && (
            <p className="stat-value green" style={{ marginTop: 16, fontSize: '1rem' }}>{successMsg}</p>
          )}

        </div>
      )}

      {mode === 'journal' && (
        <div className="receipts-body">
          {deliveries.length === 0
            ? <p className="empty-hint">Поставок ще не було</p>
            : groupByDay(deliveries).map(group => (
              <section key={group.key}>
                <h3 className="receipts-day-header">{group.label}</h3>
                <ul className="receipts-list">
                  {group.items.map(d => (
                    <li key={d.id} className="receipt-card card">
                      <div className="receipt-head">
                        <span className="receipt-no">Поставка №{d.id}</span>
                        <span className="receipt-time">{fmtDate(d.time)} {fmtTime(d.time)}</span>
                        {d.note && <span className="receipt-cashier">{d.note}</span>}
                      </div>
                      <ul className="receipt-items">
                        {d.items.map((item, i) => (
                          <li key={i}>{item.name} × {item.qty} шт</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          }
        </div>
      )}

    </div>
  )
}
