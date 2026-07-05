import { useState } from 'react'
import { createReceipt } from '../db.js'

export default function CheckoutScreen({ cart, onConfirm, onBack }) {
  const [discount, setDiscount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0)
  const discountAmt = Math.round(subtotal * discount / 100)
  const total = subtotal - discountAmt

  function handleDiscountChange(e) {
    const v = Math.min(100, Math.max(0, Number(e.target.value) || 0))
    setDiscount(v)
  }

  async function handleConfirm() {
    setLoading(true)
    setError(null)
    try {
      await createReceipt(cart, discount)
      onConfirm()
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  return (
    <div className="checkout-layout">

      <header className="app-header">
        <button className="btn-ghost" onClick={onBack}>← Назад</button>
        <h1>ГЕРКУЛЕС ШОП</h1>
        <div style={{ width: 80 }} />
      </header>

      <div className="checkout-body">

        <section className="checkout-items card">
          <h2>Позиції</h2>
          <ul className="receipt-list">
            {cart.map(item => (
              <li key={item.id} className="receipt-row">
                <span>{item.name}</span>
                <span style={{ color: 'var(--c-muted)' }}>{item.qty} × {item.price.toLocaleString('uk-UA')} ₴</span>
                <span style={{ fontWeight: 600 }}>{(item.price * item.qty).toLocaleString('uk-UA')} ₴</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="checkout-summary card">
          <div className="summary-row">
            <span>Сума без знижки</span>
            <span>{subtotal.toLocaleString('uk-UA')} ₴</span>
          </div>

          <div className="summary-row discount-row">
            <label htmlFor="discount-input">Знижка</label>
            <div className="discount-input-wrap">
              <input
                id="discount-input"
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                value={discount || ''}
                placeholder="0"
                onChange={handleDiscountChange}
              />
              <span>%</span>
            </div>
            {discount > 0 && (
              <span className="discount-saved">−{discountAmt.toLocaleString('uk-UA')} ₴</span>
            )}
          </div>

          <div className="summary-row total-row">
            <strong>До сплати</strong>
            <strong>{total.toLocaleString('uk-UA')} ₴</strong>
          </div>
        </section>

        {error && <p className="error-msg">{error}</p>}

        <button
          className="btn-success btn-lg btn-full"
          onClick={handleConfirm}
          disabled={loading || cart.length === 0}
        >
          {loading ? 'Проводимо…' : `Прийняти оплату  ${total.toLocaleString('uk-UA')} ₴`}
        </button>

      </div>
    </div>
  )
}
