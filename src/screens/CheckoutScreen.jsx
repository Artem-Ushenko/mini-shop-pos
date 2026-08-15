import { useState } from 'react'
import { createReceipt, calcReceiptTotals } from '../db.js'

const DISCOUNT_PRESETS = [5, 7]

export default function CheckoutScreen({ cart, onConfirm, onBack }) {
  const [discount, setDiscount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [splitMode, setSplitMode] = useState(false)
  const [cashAmount, setCashAmount] = useState('')
  const [cardAmount, setCardAmount] = useState('')

  // Та сама функція, що й у createReceipt — суми на екрані та в чеку
  // збігаються завжди (окреме округлення тут уже давало розбіжність в 1 ₴).
  const { subtotal, discountAmt, total } = calcReceiptTotals(cart, discount)

  function handleDiscountChange(e) {
    const v = Math.min(100, Math.max(0, Number(e.target.value) || 0))
    setDiscount(v)
  }

  function handleDiscountPreset(value) {
    setDiscount(discount === value ? 0 : value)
  }

  // Продаж понад залишок уже підтверджено касиром у кошику (CashierScreen),
  // тому allowOversell — щоб транзакція не відбила той самий випадок удруге.
  async function handleConfirm(paymentMethod) {
    setLoading(true)
    setError(null)
    try {
      const receipt = await createReceipt(cart, discount, { paymentMethod, allowOversell: true })
      onConfirm(receipt)
    } catch (e) {
      setError(e.message)
      setLoading(false)
    }
  }

  function toggleSplitMode() {
    setError(null)
    if (!splitMode) { setCashAmount(String(total)); setCardAmount('0') }
    setSplitMode(!splitMode)
  }

  const splitCash = Number(cashAmount) || 0
  const splitCard = Number(cardAmount) || 0
  const splitDelta = splitCash + splitCard - total

  async function handleConfirmSplit() {
    setLoading(true)
    setError(null)
    try {
      const receipt = await createReceipt(cart, discount, {
        cashAmount: splitCash,
        cardAmount: splitCard,
        allowOversell: true
      })
      onConfirm(receipt)
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
            <div className="discount-presets">
              {DISCOUNT_PRESETS.map(preset => (
                <button
                  key={preset}
                  type="button"
                  className={`discount-preset-btn${discount === preset ? ' active' : ''}`}
                  onClick={() => handleDiscountPreset(preset)}
                >
                  {preset}%
                </button>
              ))}
            </div>
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

        {!splitMode ? (
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
        ) : (
          <section className="checkout-summary card">
            <div className="cash-count-row">
              <label htmlFor="split-cash">💵 Готівкою</label>
              <input
                id="split-cash"
                type="number"
                inputMode="numeric"
                min="0"
                value={cashAmount}
                onChange={e => setCashAmount(e.target.value)}
              />
            </div>
            <div className="cash-count-row">
              <label htmlFor="split-card">💳 Карткою</label>
              <input
                id="split-card"
                type="number"
                inputMode="numeric"
                min="0"
                value={cardAmount}
                onChange={e => setCardAmount(e.target.value)}
              />
            </div>
            <p className={`cash-delta ${splitDelta === 0 ? 'ok' : 'bad'}`} style={{ textAlign: 'right' }}>
              {splitDelta === 0
                ? '✓ Сходиться з сумою чека'
                : `Δ ${splitDelta > 0 ? '+' : ''}${splitDelta.toLocaleString('uk-UA')} ₴ до суми чека`}
            </p>
            <button
              className="btn-primary btn-lg"
              style={{ width: '100%' }}
              onClick={handleConfirmSplit}
              disabled={loading || cart.length === 0 || splitDelta !== 0}
            >
              {loading ? 'Проводимо…' : `Провести · ${total.toLocaleString('uk-UA')} ₴`}
            </button>
          </section>
        )}

        <button className="btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={toggleSplitMode}>
          {splitMode ? '← Один спосіб оплати' : 'Розділити оплату (готівка + картка)'}
        </button>

      </div>
    </div>
  )
}
