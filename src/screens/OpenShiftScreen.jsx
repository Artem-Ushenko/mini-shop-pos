import { useState, useEffect } from 'react'
import { openShift, setConfig } from '../db.js'
import { trySendReport, formatShiftOpenReport, formatShiftCloseReport, isSnapshotConfigured } from '../cloud.js'

// Без відкритої зміни продаж недоступний: цей екран стоїть між запуском каси
// і головним екраном. Журнал, облік, статистика і бекапи доступні й без зміни.
export default function OpenShiftScreen({ config, onOpened, onConfigChange, onReceipts, onManage, onStats, onBackup, onDeliveries }) {
  const [error, setError] = useState(null)
  const [opening, setOpening] = useState(false)
  const [showAddCashier, setShowAddCashier] = useState(false)
  const [newName, setNewName] = useState('')
  const [openingCash, setOpeningCash] = useState('')
  const [cloudOff, setCloudOff] = useState(false)
  const [editingLoc, setEditingLoc] = useState(false)
  const [locName, setLocName] = useState('')

  // Хмара не налаштована (немає URL+токена в config цього пристрою) —
  // звіти про зміни мовчки не підуть, тому попереджаємо ще до відкриття зміни.
  useEffect(() => {
    isSnapshotConfigured().then(ok => setCloudOff(!ok)).catch(() => {})
  }, [])

  async function handleOpen(cashier) {
    setOpening(true)
    setError(null)
    try {
      const { shift, autoClosed } = await openShift(cashier, Number(openingCash) || 0)
      // Telegram-звіти у фоні, послідовно (щоб 🔴 автозакриття прийшло перед 🟢):
      // каса не чекає хмару, невдача ставить звіт у чергу на повтор.
      ;(async () => {
        if (autoClosed) await trySendReport(formatShiftCloseReport(autoClosed))
        await trySendReport(formatShiftOpenReport(shift))
      })()
      onOpened(shift, autoClosed)
    } catch (e) {
      setError(e.message)
      setOpening(false)
    }
  }

  // Перейменування точки: нова назва піде в наступні зміни/чеки і в префікс
  // номера чека (перша літера); старі записи зберігають стару назву — історія
  // незмінна. Снапшоти на Drive почнуть іменуватись за новою назвою.
  async function handleRenameLoc(e) {
    e.preventDefault()
    const trimmed = locName.trim()
    if (!trimmed) return
    setError(null)
    try {
      const updated = await setConfig({ ...config, locationName: trimmed })
      onConfigChange(updated)
      setEditingLoc(false)
    } catch (e) {
      setError(e.message)
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
        {editingLoc ? (
          <form className="cashier-add-form" onSubmit={handleRenameLoc}>
            <input
              type="text"
              autoFocus
              placeholder="Назва / адреса точки"
              value={locName}
              onChange={e => setLocName(e.target.value)}
            />
            <button type="submit" className="btn-ghost" disabled={!locName.trim()}>Зберегти</button>
            <button type="button" className="btn-ghost-sm" onClick={() => setEditingLoc(false)}>Скасувати</button>
          </form>
        ) : (
          <p className="gate-hint">
            Точка: {config.locationName}{' '}
            <button
              className="btn-ghost-sm"
              title="Перейменувати точку"
              onClick={() => { setLocName(config.locationName); setEditingLoc(true) }}
            >✏️</button>
          </p>
        )}

        {cloudOff && (
          <div className="cloud-warn">
            ⚠️ Хмарні снапшоти й Telegram-звіти не налаштовані на цьому
            пристрої — повідомлення про відкриття/закриття змін не
            надсилатимуться.{' '}
            <button className="cloud-warn-link" onClick={onBackup}>
              Налаштувати в «Бекапах»
            </button>
          </div>
        )}

        <div className="cash-count-row" style={{ marginTop: 0 }}>
          <label htmlFor="opening-cash">Розмінна готівка в касі</label>
          <input
            id="opening-cash"
            type="number"
            inputMode="numeric"
            min="0"
            placeholder="0 ₴"
            value={openingCash}
            onChange={e => setOpeningCash(e.target.value)}
          />
        </div>

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
