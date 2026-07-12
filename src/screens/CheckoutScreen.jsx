import { useState } from 'react'
import { createReceipt, calcReceiptTotals } from '../db.js'

export default function CheckoutScreen({ cart, onConfirm, onBack }) {
  const [discount, setDiscount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Та сама функція, що й у createReceipt — суми на екрані та в чеку
  // збігаються завжди (окреме округлення тут уже давало розбіжність в 1 ₴).
  const { subtotal, discountAmt, total } = calcReceiptTotals(cart, discount)

  function handleDiscountChange(e) {
    const v = Math.min(100, Math.max(0, Number(e.target.value) || 0))
    setDiscount(v)
  }

  // Продаж понад залишок уже підтверджено касиром у кошику (CashierScreen),
  // тому allowOversell — щоб транзакція не відбила той самий випадок удруге.
  async function handleConfirm(paymentMethod) {
    setLoading(true)
    setError(null)
    try {
      await createReceipt(cart, discount, { paymentMethod, allowOversell: true })
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

        <div className="payment-buttons">
          <button
            className="btn-success btn-lg"
            onClick={() => handleConfirm('готівка')}
            disabled={loading || cart.length === 0}
          >
            {loading ? 'Проводимо…' : `💵 Готівка · ${total.toLocaleString('uk-UA')} ₴`}
          </button>
          <button
            className="btn-primary btn-lg"
            onClick={() => handleConfirm('картка')}
            disabled={loading || cart.length === 0}
          >
            {loading ? 'Проводимо…' : `💳 Картка · ${total.toLocaleString('uk-UA')} ₴`}
          </button>
        </div>

      </div>
    </div>
  )
}
