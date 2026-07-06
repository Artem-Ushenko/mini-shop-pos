import { useState, useEffect, useMemo } from 'react'
import { getCategories, getProducts } from '../db.js'

export default function CashierScreen({ cart, setCart, onCheckout, onReceipts, onManage, onStats, onBackup }) {
  const [categories, setCategories] = useState([])
  const [catalog, setCatalog] = useState([])
  const [activeCat, setActiveCat] = useState(null)
  const [search, setSearch] = useState('')

  async function loadCatalog() {
    const [cats, prods] = await Promise.all([getCategories(), getProducts()])
    setCategories(cats)
    setCatalog(prods)
    if (cats.length) setActiveCat(cats[0].id)
  }

  useEffect(() => {
    loadCatalog()
  }, [])

  const displayed = useMemo(() => {
    let result = catalog
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(p => p.name.toLowerCase().includes(q))
    } else if (activeCat) {
      result = result.filter(p => p.cat === activeCat)
    }
    // Товари в наявності — спершу, немає в наявності — в кінці списку
    return [...result].sort((a, b) => (a.stock === 0) - (b.stock === 0))
  }, [catalog, search, activeCat])

  // Скільки одиниць товару вже в кошику
  const inCartQty = (id) => cart.find(i => i.id === id)?.qty ?? 0

  function addToCart(product) {
    const alreadyIn = inCartQty(product.id)
    if (alreadyIn >= product.stock) return
    setCart(prev => {
      const exists = prev.find(i => i.id === product.id)
      if (exists) return prev.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { id: product.id, name: product.name, price: product.price, qty: 1 }]
    })
  }

  function updateQty(id, delta) {
    setCart(prev => {
      const item = prev.find(i => i.id === id)
      if (!item) return prev
      const newQty = item.qty + delta
      if (newQty <= 0) return prev.filter(i => i.id !== id)
      const product = catalog.find(p => p.id === id)
      if (product && newQty > product.stock) return prev
      return prev.map(i => i.id === id ? { ...i, qty: newQty } : i)
    })
  }

  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0)

  return (
    <div className="cashier-layout">

      {/* ── Каталог (ліворуч) ──────────────────────────────── */}
      <div className="catalog-panel">

        <header className="app-header">
          <h1>ГЕРКУЛЕС ШОП</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ghost" onClick={onManage}>Облік товарів</button>
            <button className="btn-ghost" onClick={onReceipts}>Журнал</button>
            <button className="btn-ghost" onClick={onStats}>Статистика</button>
            <button className="btn-ghost" onClick={onBackup}>Бекапи</button>
          </div>
        </header>

        <div className="search-bar">
          <input
            type="search"
            placeholder="Пошук товару…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {!search && (
          <div className="category-tabs">
            {categories.map(cat => (
              <button
                key={cat.id}
                className={`tab${activeCat === cat.id ? ' active' : ''}`}
                onClick={() => setActiveCat(cat.id)}
              >
                {cat.emoji} {cat.name}
              </button>
            ))}
          </div>
        )}

        <div className="product-table-wrap">
          {catalog.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 16px' }}>
              <p className="empty-hint" style={{ padding: 0, marginBottom: 12 }}>
                Каталог порожній
              </p>
              <p style={{ fontSize: '0.875rem', color: 'var(--c-muted)' }}>
                Перевірте файл <code>public/catalog.csv</code> — каса читає його автоматично при запуску
              </p>
            </div>
          )}
          {catalog.length > 0 && displayed.length === 0 && (
            <p className="empty-hint">Нічого не знайдено</p>
          )}
          {catalog.length > 0 && displayed.length > 0 && (
            <table className="product-table">
              <thead>
                <tr>
                  <th>Назва</th>
                  <th>Ціна</th>
                  <th>Залишок</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(product => {
                  const qty = inCartQty(product.id)
                  const outOfStock = product.stock === 0
                  return (
                    <tr
                      key={product.id}
                      className={`product-row${outOfStock ? ' disabled' : ''}${qty > 0 ? ' in-cart' : ''}`}
                      onClick={() => !outOfStock && addToCart(product)}
                    >
                      <td className="product-name">{product.name}</td>
                      <td className="product-price">{product.price.toLocaleString('uk-UA')} ₴</td>
                      <td className="product-stock">
                        {outOfStock ? 'Немає в наявності' : `${product.stock} шт`}
                        {qty > 0 && ` · у кошику: ${qty}`}
                      </td>
                      <td className="product-row-action">
                        <button
                          className="btn-add-row"
                          onClick={e => { e.stopPropagation(); addToCart(product) }}
                          disabled={outOfStock}
                        >
                          +
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Кошик (праворуч) ──────────────────────────────── */}
      <aside className="cart-panel">
        <h2>Кошик</h2>

        {cart.length === 0
          ? <p className="empty-hint">Оберіть товари</p>
          : (
            <ul className="cart-list">
              {cart.map(item => (
                <li key={item.id} className="cart-item">
                  <div className="cart-item-top">
                    <span className="cart-item-name">{item.name}</span>
                    <span className="cart-item-subtotal">
                      {(item.price * item.qty).toLocaleString('uk-UA')} ₴
                    </span>
                  </div>
                  <div className="cart-item-controls">
                    <button className="qty-btn" onClick={() => updateQty(item.id, -1)}>−</button>
                    <span className="qty-value">{item.qty}</span>
                    <button className="qty-btn" onClick={() => updateQty(item.id, +1)}>+</button>
                    <button
                      className="remove-btn"
                      onClick={() => setCart(prev => prev.filter(i => i.id !== item.id))}
                      title="Прибрати"
                    >✕</button>
                  </div>
                </li>
              ))}
            </ul>
          )
        }

        <div className="cart-footer">
          <div className="cart-total">
            <span>Сума</span>
            <strong>{cartTotal.toLocaleString('uk-UA')} ₴</strong>
          </div>
          <button
            className="btn-primary btn-lg"
            onClick={onCheckout}
            disabled={cart.length === 0}
          >
            До оплати →
          </button>
        </div>
      </aside>

    </div>
  )
}
