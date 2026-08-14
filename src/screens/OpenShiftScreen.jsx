import { useState, useEffect } from 'react'
import { openShift, setConfig } from '../db.js'
import { trySendReport, formatShiftCloseReport, isSnapshotConfigured } from '../cloud.js'

// Без відкритої зміни продаж недоступний: цей екран стоїть між запуском каси
// і головним екраном. Журнал, облік, статистика і бекапи доступні й без зміни.
export default function OpenShiftScreen({ config, onOpened, onConfigChange, onReceipts, onManage, onSettings }) {
  const [error, setError] = useState(null)
  const [opening, setOpening] = useState(false)
  const [confirmingCashier, setConfirmingCashier] = useState(null)
  const [showAddCashier, setShowAddCashier] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingCashier, setEditingCashier] = useState(null)
  const [editCashierName, setEditCashierName] = useState('')
  const [confirmingDeleteCashier, setConfirmingDeleteCashier] = useState(null)
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
      // Звіти шлються лише по закінченню зміни: якщо попередня зміна щойно
      // закрилась автоматично (забули закрити вручну) — це і є той момент.
      // Каса не чекає хмару, невдача ставить звіт у чергу на повтор.
      if (autoClosed) trySendReport(formatShiftCloseReport(autoClosed))
      onOpened(shift, autoClosed)
    } catch (e) {
      setError(e.message)
      setOpening(false)
      setConfirmingCashier(null)
    }
  }

  function handleConfirmOpen() {
    handleOpen(confirmingCashier)
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

  async function handleRenameCashier(oldName) {
    const trimmed = editCashierName.trim()
    if (!trimmed) return
    if (trimmed !== oldName && config.cashiers.includes(trimmed)) {
      setError('Такий касир вже є')
      return
    }
    setError(null)
    try {
      const updated = await setConfig({
        ...config,
        cashiers: config.cashiers.map(x => x === oldName ? trimmed : x),
      })
      onConfigChange(updated)
      setEditingCashier(null)
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleDeleteCashier(name) {
    setError(null)
    try {
      const updated = await setConfig({
        ...config,
        cashiers: config.cashiers.filter(x => x !== name),
      })
      onConfigChange(updated)
      setConfirmingDeleteCashier(null)
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
            пристрої — повідомлення про закриття змін не надсилатимуться.{' '}
            <button className="cloud-warn-link" onClick={onSettings}>
              Налаштувати в «Налаштуваннях»
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
            <div key={c} className="cashier-pick-row">
              {editingCashier === c ? (
                <div className="manage-edit-form">
                  <div className="manage-form-row">
                    <input
                      type="text"
                      autoFocus
                      value={editCashierName}
                      onChange={e => setEditCashierName(e.target.value)}
                    />
                  </div>
                  <div className="manage-edit-actions">
                    <button className="btn-primary" disabled={!editCashierName.trim()} onClick={() => handleRenameCashier(c)}>
                      Зберегти
                    </button>
                    <button className="btn-ghost-sm" onClick={() => setEditingCashier(null)}>Скасувати</button>
                  </div>
                </div>
              ) : confirmingDeleteCashier === c ? (
                <div className="cancel-confirm">
                  <span>Видалити «{c}»?</span>
                  <button className="btn-danger" style={{ minHeight: 36, padding: '6px 14px' }} onClick={() => handleDeleteCashier(c)}>
                    Так
                  </button>
                  <button className="btn-ghost-sm" onClick={() => setConfirmingDeleteCashier(null)}>Ні</button>
                </div>
              ) : (
                <>
                  <button
                    className="cashier-pick-btn"
                    disabled={opening}
                    onClick={() => setConfirmingCashier(c)}
                  >
                    👤 {c}
                  </button>
                  <button
                    className="cashier-row-icon-btn"
                    title="Перейменувати"
                    onClick={() => { setEditingCashier(c); setEditCashierName(c) }}
                  >✏️</button>
                  <button
                    className="cashier-row-icon-btn danger"
                    title="Видалити"
                    onClick={() => setConfirmingDeleteCashier(c)}
                  >✕</button>
                </>
              )}
            </div>
          ))}
        </div>

        {confirmingCashier && (
          <div className="modal-overlay" onClick={() => !opening && setConfirmingCashier(null)}>
            <div className="card modal-card" onClick={e => e.stopPropagation()}>
              <h2>Відкрити зміну?</h2>
              <ul className="shift-summary">
                <li><span>Касир</span><strong>👤 {confirmingCashier}</strong></li>
                <li><span>Точка</span><strong>{config.locationName}</strong></li>
                <li><span>Розмінна готівка</span><strong>{(Number(openingCash) || 0).toLocaleString('uk-UA')} ₴</strong></li>
              </ul>
              <div className="modal-actions">
                <button className="btn-ghost" disabled={opening} onClick={() => setConfirmingCashier(null)}>
                  Скасувати
                </button>
                <button className="btn-primary" disabled={opening} onClick={handleConfirmOpen}>
                  {opening ? 'Відкриваємо…' : 'Так, відкрити зміну'}
                </button>
              </div>
            </div>
          </div>
        )}

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
          <button className="btn-ghost-sm" onClick={onReceipts}>Журнал</button>
          <button className="btn-ghost-sm" onClick={onSettings}>Налаштування</button>
        </div>
      </div>
    </div>
  )
}
