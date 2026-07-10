import { useState } from 'react'
import { openShift, setConfig } from '../db.js'

// Без відкритої зміни продаж недоступний: цей екран стоїть між запуском каси
// і головним екраном. Журнал, облік, статистика і бекапи доступні й без зміни.
export default function OpenShiftScreen({ config, onOpened, onConfigChange, onReceipts, onManage, onStats, onBackup, onDeliveries }) {
  const [error, setError] = useState(null)
  const [opening, setOpening] = useState(false)
  const [showAddCashier, setShowAddCashier] = useState(false)
  const [newName, setNewName] = useState('')

  async function handleOpen(cashier) {
    setOpening(true)
    setError(null)
    try {
      const { shift, autoClosed } = await openShift(cashier)
      onOpened(shift, autoClosed)
    } catch (e) {
      setError(e.message)
      setOpening(false)
    }
  }

  async function handleAddCashier(e) {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed || config.cashiers.includes(trimmed)) return
    setError(null)
    try {
      const updated = await setConfig({ ...config, cashiers: [...config.cashiers, trimmed] })
      onConfigChange(updated)
      setNewName('')
      setShowAddCashier(false)
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="gate-screen">
      <div className="card gate-card gate-card-wide">
        <h1>ГЕРКУЛЕС ШОП</h1>
        <p className="gate-hint">
          Точка: {config.locationName}
        </p>

        <h2 className="setup-subtitle">Хто відкриває зміну?</h2>
        <div className="cashier-pick-list">
          {config.cashiers.map(c => (
            <button
              key={c}
              className="cashier-pick-btn"
              disabled={opening}
              onClick={() => handleOpen(c)}
            >
              👤 {c}
            </button>
          ))}
        </div>

        {showAddCashier ? (
          <form className="cashier-add-form" onSubmit={handleAddCashier}>
            <input
              type="text"
              autoFocus
              placeholder="Ім'я касира"
              value={newName}
              onChange={e => setNewName(e.target.value)}
            />
            <button type="submit" className="btn-ghost" disabled={!newName.trim()}>Додати</button>
          </form>
        ) : (
          <button className="btn-ghost-sm" onClick={() => setShowAddCashier(true)}>
            + Додати касира
          </button>
        )}

        {error && <p className="error-msg">{error}</p>}

        <div className="shift-screen-links">
          <button className="btn-ghost-sm" onClick={onManage}>Облік товарів</button>
          <button className="btn-ghost-sm" onClick={onDeliveries}>Поставки</button>
          <button className="btn-ghost-sm" onClick={onReceipts}>Журнал</button>
          <button className="btn-ghost-sm" onClick={onStats}>Статистика</button>
          <button className="btn-ghost-sm" onClick={onBackup}>Бекапи</button>
        </div>
      </div>
    </div>
  )
}
