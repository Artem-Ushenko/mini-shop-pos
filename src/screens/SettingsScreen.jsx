import { useState } from 'react'
import StatsScreen from './StatsScreen.jsx'
import BackupScreen from './BackupScreen.jsx'

// «Налаштування» — доступний лише адміністратору (гейт у App.jsx, той самий
// пароль, що й для «Облік товарів»): об'єднує Статистику і Бекапи в одну
// вкладку, бо обидва — не щоденний інструмент касира, а огляд/адміністрування.
export default function SettingsScreen({ onBack }) {
  const [tab, setTab] = useState('stats') // 'stats' | 'backup'

  return (
    <div className="manage-layout">

      <header className="app-header">
        <button className="btn-ghost" onClick={onBack}>← Назад</button>
        <h1>ГЕРКУЛЕС ШОП · Налаштування</h1>
        <div style={{ width: 80 }} />
      </header>

      <div className="category-tabs">
        <button
          className={`tab${tab === 'stats' ? ' active' : ''}`}
          onClick={() => setTab('stats')}
        >
          Статистика
        </button>
        <button
          className={`tab${tab === 'backup' ? ' active' : ''}`}
          onClick={() => setTab('backup')}
        >
          Бекапи
        </button>
      </div>

      {tab === 'stats' && <StatsScreen />}
      {tab === 'backup' && <BackupScreen />}
    </div>
  )
}
