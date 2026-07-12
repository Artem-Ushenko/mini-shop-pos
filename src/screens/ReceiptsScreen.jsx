import { useState, useEffect } from 'react'
import { getReceipts, cancelReceipt, getDayTotal, CANCEL_REASONS } from '../db.js'

// Старі чеки (до впровадження змін) мають лише числовий no,
// нові — людський номер за зміну («М-1»)
function receiptLabel(r) {
  return r.shiftNo ? `Чек ${r.shiftNo}` : `Чек №${r.no}`
}

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

// Групує чеки (вже відсортовані від найновіших) за днем: "Сьогодні" окремо,
// попередні дні — під заголовком з датою.
function groupByDay(receipts) {
  const todayKey = dayKey(Date.now())
  const groups = []
  for (const r of receipts) {
    const key = dayKey(r.time)
    const label = key === todayKey ? 'Сьогодні' : fmtDate(r.time)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(r)
    else groups.push({ key, label, items: [r] })
  }
  return groups
}

// onEditReceipt передається лише при відкритій зміні: «правка» чека — це
// сторно з причиною «виправлення» + перенесення позицій у кошик, щоб касир
// додав/прибрав потрібне і провів новий чек. Сам чек у журналі незмінний.
export default function ReceiptsScreen({ onBack, onEditReceipt }) {
  const [receipts, setReceipts] = useState([])
  const [dayTotal, setDayTotal] = useState({ sum: 0, count: 0 })
  const [confirmingNo, setConfirmingNo] = useState(null)
  const [editingNo, setEditingNo] = useState(null)
  const [error, setError] = useState(null)

  async function load() {
    const [recs, total] = await Promise.all([getReceipts(), getDayTotal()])
    setReceipts([...recs].reverse()) // найновіші зверху
    setDayTotal(total)
  }

  useEffect(() => { load() }, [])

  async function handleCancel(no, reason) {
    setError(null)
    try {
      await cancelReceipt(no, reason)
      setConfirmingNo(null)
      await load()
    } catch (e) {
      setError(e.message)
      setConfirmingNo(null)
    }
  }

  async function handleEdit(receipt) {
    setError(null)
    try {
      await cancelReceipt(receipt.no, 'виправлення')
      onEditReceipt(receipt)
    } catch (e) {
      setError(e.message)
      setEditingNo(null)
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
          ? <p className="empty-hint">Чеків ще немає</p>
          : groupByDay(receipts).map(group => (
            <section key={group.key}>
              <h3 className="receipts-day-header">{group.label}</h3>
              <ul className="receipts-list">
                {group.items.map(r => (
                  <li key={r.no} className={`receipt-card card${r.cancelled ? ' cancelled' : ''}`}>

                    <div className="receipt-head">
                      <span className="receipt-no">{receiptLabel(r)}</span>
                      <span className="receipt-time">{fmtDate(r.time)} {fmtTime(r.time)}</span>
                      {r.cashier && <span className="receipt-cashier">👤 {r.cashier}</span>}
                      {r.paymentMethod && (
                        <span className="receipt-cashier">
                          {r.paymentMethod === 'картка' ? '💳 картка' : '💵 готівка'}
                        </span>
                      )}
                      {r.cancelled && (
                        <span className="badge-cancelled">
                          СТОРНО{r.cancelReason ? ` · ${r.cancelReason}` : ''}
                        </span>
                      )}
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

                      {!r.cancelled && confirmingNo !== r.no && editingNo !== r.no && onEditReceipt && (
                        <button
                          className="btn-ghost-sm"
                          onClick={() => { setConfirmingNo(null); setEditingNo(r.no) }}
                        >
                          ✏️ Виправити
                        </button>
                      )}

                      {!r.cancelled && editingNo === r.no && (
                        <div className="cancel-confirm">
                          <span>
                            Чек буде сторновано (виправлення), позиції перейдуть у кошик —
                            відредагуйте і проведіть новий чек.
                          </span>
                          <button
                            className="btn-primary"
                            style={{ minHeight: 36, padding: '6px 14px' }}
                            onClick={() => handleEdit(r)}
                          >
                            Виправити
                          </button>
                          <button className="btn-ghost-sm" onClick={() => setEditingNo(null)}>
                            Скасувати
                          </button>
                        </div>
                      )}

                      {!r.cancelled && confirmingNo !== r.no && editingNo !== r.no && (
                        <button
                          className="btn-ghost-sm"
                          style={{ color: 'var(--c-danger)' }}
                          onClick={() => { setEditingNo(null); setConfirmingNo(r.no) }}
                        >
                          Сторно
                        </button>
                      )}

                      {!r.cancelled && confirmingNo === r.no && (
                        <div className="cancel-confirm">
                          <span>Причина сторно ({r.shiftNo ?? `№${r.no}`}):</span>
                          {CANCEL_REASONS.map(reason => (
                            <button
                              key={reason}
                              className="btn-danger"
                              style={{ minHeight: 36, padding: '6px 14px' }}
                              onClick={() => handleCancel(r.no, reason)}
                            >
                              {reason[0].toUpperCase() + reason.slice(1)}
                            </button>
                          ))}
                          <button className="btn-ghost-sm" onClick={() => setConfirmingNo(null)}>
                            Не скасовувати
                          </button>
                        </div>
                      )}
                    </div>

                  </li>
                ))}
              </ul>
            </section>
          ))
        }

      </div>
    </div>
  )
}
