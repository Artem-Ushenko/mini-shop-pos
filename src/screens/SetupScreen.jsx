import { useState } from 'react'
import { setConfig } from '../db.js'

// Екран першого запуску: разово прив'язує пристрій до точки продажу
// (вільна назва/адреса — кількість точок наперед невідома) і задає список
// касирів. Далі каса стартує одразу з відкриття зміни.
export default function SetupScreen({ onDone }) {
  const [locationName, setLocationName] = useState('')
  const [cashiers, setCashiers] = useState([])
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  function addCashier(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || cashiers.includes(trimmed)) return
    setCashiers(prev => [...prev, trimmed])
    setName('')
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const config = await setConfig({ locationName, cashiers })
      onDone(config)
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="gate-screen">
      <div className="card gate-card gate-card-wide">
        <h1>ГЕРКУЛЕС ШОП</h1>
        <p className="gate-hint">
          Налаштування каси — разова дія при першому запуску на цьому пристрої
        </p>

        <h2 className="setup-subtitle">Точка продажу</h2>
        <input
          className="setup-location-input"
          type="text"
          placeholder="Назва / адреса точки, напр.: Магазин, вул. Шевченка 12"
          value={locationName}
          onChange={e => setLocationName(e.target.value)}
        />
        <p className="setup-hint-small">
          Записується в кожну зміну і чек цієї каси. Перша літера стане префіксом номера чека.
        </p>

        <h2 className="setup-subtitle">Касири</h2>
        {cashiers.length > 0 && (
          <ul className="cashier-name-list">
            {cashiers.map(c => (
              <li key={c}>
                <span>{c}</span>
                <button
                  className="remove-btn"
                  title="Прибрати"
                  onClick={() => setCashiers(prev => prev.filter(x => x !== c))}
                >✕</button>
              </li>
            ))}
          </ul>
        )}
        <form className="cashier-add-form" onSubmit={addCashier}>
          <input
            type="text"
            placeholder="Ім'я касира"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <button type="submit" className="btn-ghost" disabled={!name.trim()}>Додати</button>
        </form>

        {error && <p className="error-msg">{error}</p>}

        <button
          className="btn-primary btn-full"
          disabled={!locationName.trim() || cashiers.length === 0 || saving}
          onClick={handleSave}
        >
          {saving ? 'Зберігаємо…' : 'Зберегти і почати роботу'}
        </button>
      </div>
    </div>
  )
}
