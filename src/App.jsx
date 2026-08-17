import { useEffect, useState } from 'react'
import { initDB, getConfig, getCurrentShift } from './db.js'
import { importFromFile } from './sync.js'
import { retryPending } from './cloud.js'
import { initLocalBackup, bindLocalBackupUnload } from './localBackup.js'
import CashierScreen from './screens/CashierScreen.jsx'
import CheckoutScreen from './screens/CheckoutScreen.jsx'
import ReceiptsScreen from './screens/ReceiptsScreen.jsx'
import ManageCatalogScreen from './screens/ManageCatalogScreen.jsx'
import SettingsScreen from './screens/SettingsScreen.jsx'
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

// Пароль каси (.env → VITE_ADMIN_PASSWORD_SHA256) захищає лише чутливі
// екрани — «Облік товарів» і «Налаштування». Вхід у саму касу (продаж,
// зміни, чеки) пароля не потребує. Пароль питається щоразу при переході
// в чутливий екран — розблокування не запам'ятовується.
// У бандл потрапляє лише SHA-256-хеш: публічно розгорнутий JS читається
// будь-ким, відкритий текст пароля там — дірка. Локальна розробка без
// .env пароль не питає.
const ADMIN_PASSWORD_HASH = import.meta.env.VITE_ADMIN_PASSWORD_SHA256

// Дані каси (IndexedDB) прив'язані до адреси. Каса, відкрита за будь-якою
// іншою адресою (порт 5174, 127.0.0.1, IP по мережі), бачить ІНШЕ, порожнє
// сховище — попереджаємо, поки касир не наналаштовував «примарну» касу.
const CANONICAL_ORIGIN = 'http://localhost:5173'
const wrongAddressBanner = window.location.origin !== CANONICAL_ORIGIN ? (
  <div className="offline-banner sync-error-banner">
    ⚠️ Каса відкрита за адресою {window.location.host} — тут дані основної
    каси НЕ видно. Закрийте всі вікна сервера, запустіть run.bat один раз і
    відкрийте localhost:5173
  </div>
) : null

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
  const [saleToast, setSaleToast] = useState(null)
  // Екран, вхід у який зараз перевіряється паролем ('manage' | 'settings' | null).
  const [gateTarget, setGateTarget] = useState(null)

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
    boot().then(() => retryPending())
    initLocalBackup()
    bindLocalBackupUnload()

    // При появі мережі — досилаємо відкладені Telegram-звіти і снапшот (якщо є).
    const goOnline  = () => { setIsOnline(true); retryPending() }
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online',  goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online',  goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // Підтвердження продажу зникає само — не вимагає дії касира, щоб не
  // сповільнювати чергу наступних продажів.
  useEffect(() => {
    if (!saleToast) return
    const timer = setTimeout(() => setSaleToast(null), 3000)
    return () => clearTimeout(timer)
  }, [saleToast])

  if (dbError)  return <div className="loading-screen err">Помилка бази: {dbError}</div>
  if (!dbReady) return <div className="loading-screen">Завантаження…</div>

  // Перший запуск на пристрої: спочатку точка продажу і касири.
  // Перевірка на locationName також переналаштовує конфіг старого формату.
  if (!config?.locationName) return <>{wrongAddressBanner}<SetupScreen onDone={setConfigState} /></>

  // «Облік товарів» і «Налаштування» — чутливі екрани: перехід у них питає
  // пароль щоразу заново (без запам'ятовування розблокування).
  function enterProtected(target) {
    if (ADMIN_PASSWORD_HASH) setGateTarget(target)
    else setScreen(target)
  }

  const goTo = {
    onReceipts: () => setScreen('receipts'),
    onManage: () => enterProtected('manage'),
    onSettings: () => enterProtected('settings'),
  }

  // Забута вчорашня зміна не продовжується мовчки: каса показує екран
  // відкриття, а openShift() закриє стару від імені системи (сценарій 7.2).
  const activeShift = shift && isToday(shift.openedAt) ? shift : null

  if (gateTarget) {
    return (
      <>
        {wrongAddressBanner}
        <PasswordGate
          correctHash={ADMIN_PASSWORD_HASH}
          hint="Введіть пароль адміністратора"
          onUnlock={() => { setScreen(gateTarget); setGateTarget(null) }}
          onBack={() => setGateTarget(null)}
        />
      </>
    )
  }

  return (
    <>
      {wrongAddressBanner}
      {!isOnline && (
        <div className="offline-banner">
          Офлайн — каса працює, всі дані зберігаються на цьому пристрої
        </div>
      )}
      {syncError && (
        <div className="offline-banner sync-error-banner">{syncError}</div>
      )}
      {saleToast && (
        <div className="sale-toast">
          ✅ Чек {saleToast.shiftNo ? `№${saleToast.shiftNo}` : `№${saleToast.no}`} проведено · {saleToast.total.toLocaleString('uk-UA')} ₴
        </div>
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
          onConfirm={(receipt) => {
            setCart([])
            setScreen('cashier')
            setSaleToast(receipt)
          }}
          onBack={() => setScreen('cashier')}
        />
      )}
      {screen === 'receipts' && (
        <ReceiptsScreen onBack={() => setScreen('cashier')} />
      )}
      {screen === 'manage' && (
        <ManageCatalogScreen onBack={() => setScreen('cashier')} />
      )}
      {screen === 'settings' && (
        <SettingsScreen onBack={() => setScreen('cashier')} />
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
