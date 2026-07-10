import { useEffect, useState } from 'react'
import { initDB, getConfig, getCurrentShift } from './db.js'
import { importFromFile } from './sync.js'
import CashierScreen from './screens/CashierScreen.jsx'
import CheckoutScreen from './screens/CheckoutScreen.jsx'
import ReceiptsScreen from './screens/ReceiptsScreen.jsx'
import ManageCatalogScreen from './screens/ManageCatalogScreen.jsx'
import StatsScreen from './screens/StatsScreen.jsx'
import BackupScreen from './screens/BackupScreen.jsx'
import DeliveriesScreen from './screens/DeliveriesScreen.jsx'
import PasswordGate from './screens/PasswordGate.jsx'
import SetupScreen from './screens/SetupScreen.jsx'
import OpenShiftScreen from './screens/OpenShiftScreen.jsx'
import './index.css'

function fmtDate(ts) {
  const d = new Date(ts)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function isToday(ts) {
  const d = new Date(ts)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

// Постійний шлях каталогу — основний і незмінний файл, читається автоматично
// при кожному запуску каси, без ручного імпорту.
const CATALOG_URL = '/catalog.csv'

// Задається через .env (VITE_APP_PASSWORD) лише для публічно розгорнутих
// збірок (напр. Firebase Hosting) — локальна розробка без .env пароль не питає.
const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD
const UNLOCK_KEY = 'kasa-unlocked'

// Пароль адміністратора (.env → VITE_ADMIN_PASSWORD): без нього касир не
// потрапить в «Облік товарів». Питається щоразу — розблокування не
// запам'ятовується, бо каса лишається відкритою на пристрої всю зміну.
const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD

export default function App() {
  const [screen, setScreen]   = useState('cashier')
  const [cart, setCart]       = useState([])
  const [dbReady, setDbReady] = useState(false)
  const [dbError, setDbError] = useState(null)
  const [syncError, setSyncError] = useState(null)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [config, setConfigState] = useState(null)
  const [shift, setShift] = useState(null)
  const [autoClosedShift, setAutoClosedShift] = useState(null)
  const [adminUnlocked, setAdminUnlocked] = useState(false)
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
        setConfigState(await getConfig())
        setShift(await getCurrentShift())
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

  // Перший запуск на пристрої: спочатку точка продажу і касири.
  // Перевірка на locationName також переналаштовує конфіг старого формату.
  if (!config?.locationName) return <SetupScreen onDone={setConfigState} />

  const goTo = {
    onReceipts: () => setScreen('receipts'),
    onManage: () => setScreen('manage'),
    onStats: () => setScreen('stats'),
    onBackup: () => setScreen('backup'),
    onDeliveries: () => setScreen('deliveries'),
  }

  // Забута вчорашня зміна не продовжується мовчки: каса показує екран
  // відкриття, а openShift() закриє стару від імені системи (сценарій 7.2).
  const activeShift = shift && isToday(shift.openedAt) ? shift : null

  return (
    <>
      {!isOnline && (
        <div className="offline-banner">
          Офлайн — дані зберігаються локально, синхронізація при відновленні мережі
        </div>
      )}
      {syncError && (
        <div className="offline-banner sync-error-banner">{syncError}</div>
      )}
      {autoClosedShift && (
        <div className="offline-banner autoclose-banner">
          Зміна за {fmtDate(autoClosedShift.openedAt)} ({autoClosedShift.cashier}) закрита автоматично
          <button className="banner-dismiss" onClick={() => setAutoClosedShift(null)}>✕</button>
        </div>
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
      {screen === 'manage' && ADMIN_PASSWORD && !adminUnlocked && (
        <PasswordGate
          correctPassword={ADMIN_PASSWORD}
          hint="Облік товарів доступний лише адміністратору"
          onUnlock={() => setAdminUnlocked(true)}
          onBack={() => setScreen('cashier')}
        />
      )}
      {screen === 'manage' && (!ADMIN_PASSWORD || adminUnlocked) && (
        <ManageCatalogScreen
          onBack={() => { setAdminUnlocked(false); setScreen('cashier') }}
        />
      )}
      {screen === 'stats' && (
        <StatsScreen onBack={() => setScreen('cashier')} />
      )}
      {screen === 'backup' && (
        <BackupScreen onBack={() => setScreen('cashier')} />
      )}
      {screen === 'deliveries' && (
        <DeliveriesScreen onBack={() => setScreen('cashier')} />
      )}
      {screen === 'cashier' && !activeShift && (
        <OpenShiftScreen
          config={config}
          onConfigChange={setConfigState}
          onOpened={(newShift, autoClosed) => {
            setShift(newShift)
            setAutoClosedShift(autoClosed)
          }}
          {...goTo}
        />
      )}
      {screen === 'cashier' && activeShift && (
        <CashierScreen
          cart={cart}
          setCart={setCart}
          shift={activeShift}
          onShiftClosed={() => { setCart([]); setShift(null) }}
          onCheckout={() => setScreen('checkout')}
          {...goTo}
        />
      )}
    </>
  )
}
