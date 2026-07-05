import { useState, useEffect } from 'react'
import { getReceipts, cancelReceipt, getDayTotal } from '../db.js'

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
}

export default function ReceiptsScreen({ onBack }) {
  const [receipts, setReceipts] = useState([])
  const [dayTotal, setDayTotal] = useState({ sum: 0, count: 0 })
  const [confirmingNo, setConfirmingNo] = useState(null)
  const [error, setError] = useState(null)

  async function load() {
    const [recs, total] = await Promise.all([getReceipts(), getDayTotal()])
    setReceipts([...recs].reverse()) // найновіші зверху
    setDayTotal(total)
  }

  useEffect(() => { load() }, [])

  async function handleCancel(no) {
    setError(null)
    try {
      await cancelReceipt(no)
      setConfirmingNo(null)
      await load()
    } catch (e) {
      setError(e.message)
      setConfirmingNo(null)
    }
  }

  return (
    <div className="receipts-layout">

      <header className="app-header">
        <button className="btn-ghost" onClick={onBack}>← Назад</button>
        <h1>ГЕРКУЛЕС ШОП · Журнал</h1>
        <div style={{ width: 80 }} />
      </header>

      <div className="receipts-body">

        <section className="day-total card">
          <div>
            <span className="day-total-label">Чеків за сьогодні</span>
            <span className="day-total-val">{dayTotal.count}</span>
          </div>
          <div>
            <span className="day-total-label">Виручка</span>
            <span className="day-total-val green">{dayTotal.sum.toLocaleString('uk-UA')} ₴</span>
          </div>
        </section>

        {error && <p className="error-msg">{error}</p>}

        {receipts.length === 0
          ? <p className="empty-hint">Чеків за сьогодні немає</p>
          : (
            <ul className="receipts-list">
              {receipts.map(r => (
                <li key={r.no} className={`receipt-card card${r.cancelled ? ' cancelled' : ''}`}>

                  <div className="receipt-head">
                    <span className="receipt-no">Чек №{r.no}</span>
                    <span className="receipt-time">{fmtTime(r.time)}</span>
                    {r.cancelled && <span className="badge-cancelled">СТОРНО</span>}
                  </div>

                  <ul className="receipt-items">
                    {r.items.map((item, i) => (
                      <li key={i}>
                        {item.name} × {item.qty} — {(item.price * item.qty).toLocaleString('uk-UA')} ₴
                      </li>
                    ))}
                  </ul>

                  <div className="receipt-foot">
                    {r.discount > 0 && (
                      <span className="discount-tag">Знижка {r.discount}%</span>
                    )}
                    <strong>{r.total.toLocaleString('uk-UA')} ₴</strong>

                    {!r.cancelled && confirmingNo !== r.no && (
                      <button
                        className="btn-ghost-sm"
                        style={{ color: 'var(--c-danger)' }}
                        onClick={() => setConfirmingNo(r.no)}
                      >
                        Сторно
                      </button>
                    )}

                    {!r.cancelled && confirmingNo === r.no && (
                      <div className="cancel-confirm">
                        <span>Скасувати чек №{r.no}?</span>
                        <button className="btn-danger" style={{ minHeight: 36, padding: '6px 14px' }} onClick={() => handleCancel(r.no)}>
                          Так
                        </button>
                        <button className="btn-ghost-sm" onClick={() => setConfirmingNo(null)}>
                          Ні
                        </button>
                      </div>
                    )}
                  </div>

                </li>
              ))}
            </ul>
          )
        }

      </div>
    </div>
  )
}
