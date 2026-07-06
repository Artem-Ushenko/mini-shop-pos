import { useEffect, useState } from 'react'
import { initDB } from './db.js'
import { importFromFile } from './sync.js'
import CashierScreen from './screens/CashierScreen.jsx'
import CheckoutScreen from './screens/CheckoutScreen.jsx'
import ReceiptsScreen from './screens/ReceiptsScreen.jsx'
import ManageCatalogScreen from './screens/ManageCatalogScreen.jsx'
import StatsScreen from './screens/StatsScreen.jsx'
import BackupScreen from './screens/BackupScreen.jsx'
import PasswordGate from './screens/PasswordGate.jsx'
import './index.css'

// Постійний шлях каталогу — основний і незмінний файл, читається автоматично
// при кожному запуску каси, без ручного імпорту.
const CATALOG_URL = '/catalog.csv'

// Задається через .env (VITE_APP_PASSWORD) лише для публічно розгорнутих
// збірок (напр. Firebase Hosting) — локальна розробка без .env пароль не питає.
const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD
const UNLOCK_KEY = 'kasa-unlocked'

export default function App() {
  const [screen, setScreen]   = useState('cashier')
  const [cart, setCart]       = useState([])
  const [dbReady, setDbReady] = useState(false)
  const [dbError, setDbError] = useState(null)
  const [syncError, setSyncError] = useState(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [unlocked, setUnlocked] = useState(
    !APP_PASSWORD || localStorage.getItem(UNLOCK_KEY) === '1'
  )

  useEffect(() => {
    async function boot() {
      try {
        await initDB()
        try {
          const res = await fetch(CATALOG_URL)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          await importFromFile(await res.text())
        } catch (err) {
          setSyncError(`Каталог не оновлено (${CATALOG_URL}): ${err.message}`)
        }
        setDbReady(true)
      } catch (e) {
        setDbError(e.message)
      }
    }
    boot()

    const goOnline  = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online',  goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online',  goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (!unlocked) {
    return (
      <PasswordGate
        correctPassword={APP_PASSWORD}
        onUnlock={() => { localStorage.setItem(UNLOCK_KEY, '1'); setUnlocked(true) }}
      />
    )
  }

  if (dbError)  return <div className="loading-screen err">Помилка бази: {dbError}</div>
  if (!dbReady) return <div className="loading-screen">Завантаження…</div>

  const screens = (
    <>
      {!isOnline && (
        <div className="offline-banner">
          Офлайн — дані зберігаються локально, синхронізація при відновленні мережі
        </div>
      )}
      {syncError && (
        <div className="offline-banner sync-error-banner">{syncError}</div>
      )}

      {screen === 'checkout' && (
        <CheckoutScreen
          cart={cart}
          onConfirm={() => { setCart([]); setScreen('cashier') }}
          onBack={() => setScreen('cashier')}
        />
      )}
      {screen === 'receipts' && (
        <ReceiptsScreen onBack={() => setScreen('cashier')} />
      )}
      {screen === 'manage' && (
        <ManageCatalogScreen onBack={() => setScreen('cashier')} />
      )}
      {screen === 'stats' && (
        <StatsScreen onBack={() => setScreen('cashier')} />
      )}
      {screen === 'backup' && (
        <BackupScreen onBack={() => setScreen('cashier')} />
      )}
      {screen === 'cashier' && (
        <CashierScreen
          cart={cart}
          setCart={setCart}
          onCheckout={() => setScreen('checkout')}
          onReceipts={() => setScreen('receipts')}
          onManage={() => setScreen('manage')}
          onStats={() => setScreen('stats')}
          onBackup={() => setScreen('backup')}
        />
      )}
    </>
  )

  return screens
}
