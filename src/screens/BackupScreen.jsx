import { useState, useEffect, useRef } from 'react'
import { exportBackup, importBackup, getConfig, setConfig, resetDatabase } from '../db.js'
import { sendSnapshot, getSnapshotStatus } from '../cloud.js'
import {
  onLocalBackupStatusChange, formatLocalBackupStatus, pickLocalBackupFolder,
  reconfirmLocalBackupPermission, writeLocalBackup, getLocalBackupFolderName,
  BACKUP_INTERVAL_MIN, BACKUP_KEEP,
} from '../localBackup.js'

function fmtDateTime(ts) {
  return new Date(ts).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' })
}

// Без власного заголовка — вбудовується як вкладка «Бекапи»
// всередині SettingsScreen.jsx.
export default function BackupScreen() {
  const [backupError, setBackupError] = useState(null)
  const [pendingRestore, setPendingRestore] = useState(null)
  const [restoring, setRestoring] = useState(false)
  const backupFileInputRef = useRef(null)

  // Хмарні снапшоти (Google Drive через Apps Script-проксі)
  const [config, setConfigState] = useState(null)
  const [snapUrl, setSnapUrl] = useState('')
  const [snapToken, setSnapToken] = useState('')
  const [snapMsg, setSnapMsg] = useState(null)
  const [snapErr, setSnapErr] = useState(null)
  const [snapshotting, setSnapshotting] = useState(false)
  const [snapStatus, setSnapStatus] = useState(getSnapshotStatus())

  // best effort-захист IndexedDB від витіснення браузером — власник має
  // бачити, якщо браузер його НЕ гарантує (дані можуть зникнути під тиском місця).
  const [persisted, setPersisted] = useState(null)

  // Копія на локальний диск (Google Drive for Desktop) — той самий стек, що в Клубі
  const [localState, setLocalState] = useState(null)
  const [localAlerts, setLocalAlerts] = useState([])
  const localAlert = (message) => {
    const id = Math.random()
    setLocalAlerts((a) => [...a, { id, message }])
    setTimeout(() => setLocalAlerts((a) => a.filter((x) => x.id !== id)), 5000)
  }
  useEffect(() => onLocalBackupStatusChange(setLocalState), [])

  // Повне скидання бази (нова точка на цьому пристрої) — безповоротно,
  // тому підтвердження вимагає ввести точну назву поточної точки, а не Так/Ні.
  const [resetConfirming, setResetConfirming] = useState(false)
  const [resetTypedName, setResetTypedName] = useState('')
  const [resetError, setResetError] = useState(null)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    getConfig().then(cfg => {
      setConfigState(cfg)
      setSnapUrl(cfg?.snapshot?.url ?? '')
      setSnapToken(cfg?.snapshot?.token ?? '')
    })
    if (navigator.storage?.persisted) {
      navigator.storage.persisted().then(setPersisted).catch(() => {})
    }
  }, [])

  async function handleExportBackup() {
    setBackupError(null)
    try {
      const backup = await exportBackup()
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
      const a = document.createElement('a')
      a.href = url
      a.download = `gerkules-shop-backup-${stamp}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setBackupError(err.message)
    }
  }

  async function handleBackupFileSelect(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setBackupError(null)
    try {
      const backup = JSON.parse(await file.text())
      if (!Array.isArray(backup.categories) || !Array.isArray(backup.products) || !Array.isArray(backup.receipts)) {
        throw new Error('Невірний формат файлу бекапу')
      }
      setPendingRestore(backup)
    } catch (err) {
      setBackupError(err.message)
    }
  }

  async function handleConfirmRestore() {
    setRestoring(true)
    setBackupError(null)
    try {
      await importBackup(pendingRestore)
      window.location.reload()
    } catch (err) {
      setBackupError(err.message)
      setRestoring(false)
      setPendingRestore(null)
    }
  }

  // Пише введені URL+токен у config. Окремої кнопки «Зберегти» мало:
  // відправка теж мусить зберігати, інакше введене живе лише в полях
  // до перезавантаження, а sendSnapshot читає зі збереженого config.
  async function saveSnapshotSettings() {
    const updated = await setConfig({
      ...config,
      snapshot: { url: snapUrl.trim(), token: snapToken.trim() },
    })
    setConfigState(updated)
    return updated
  }

  async function handleSaveSnapshotSettings() {
    setSnapErr(null)
    setSnapMsg(null)
    try {
      await saveSnapshotSettings()
      setSnapMsg('Налаштування збережено')
    } catch (err) {
      setSnapErr(err.message)
    }
  }

  async function handleResetDatabase() {
    setResetError(null)
    setResetting(true)
    try {
      await resetDatabase()
      window.location.reload()
    } catch (err) {
      setResetError(err.message)
      setResetting(false)
    }
  }

  async function handleSendNow() {
    setSnapErr(null)
    setSnapMsg(null)
    setSnapshotting(true)
    try {
      await saveSnapshotSettings()
      const res = await sendSnapshot()
      setSnapMsg(`Налаштування збережено · Снапшот на Drive: ${res.file}`)
    } catch (err) {
      setSnapErr(err.message)
    } finally {
      setSnapshotting(false)
      setSnapStatus(getSnapshotStatus())
    }
  }

  return (
    <div className="manage-body manage-body-narrow">

        <div className="card manage-backup">
          <p className="backup-hint">
            Зберігає й відновлює каталог, залишки, історію чеків і змін одним файлом —
            використовуй для перенесення каси на інший ПК.
          </p>
          <div className="manage-backup-actions">
            <button className="btn-ghost" onClick={handleExportBackup}>Завантажити бекап</button>
            <input
              ref={backupFileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleBackupFileSelect}
            />
            <button className="btn-ghost" onClick={() => backupFileInputRef.current.click()}>
              Відновити з файлу…
            </button>
          </div>

          {backupError && <p className="error-msg">{backupError}</p>}

          {pendingRestore && (
            <div className="cancel-confirm" style={{ marginTop: 10, flexWrap: 'wrap' }}>
              <span>
                Замінити поточну базу бекапом від {fmtDateTime(pendingRestore.exportedAt)}
                {' '}({pendingRestore.categories.length} категорій, {pendingRestore.products.length} товарів,{' '}
                {pendingRestore.receipts.length} чеків)? Поточні дані на цьому пристрої буде втрачено.
              </span>
              <button className="btn-danger" disabled={restoring} onClick={handleConfirmRestore}>
                {restoring ? 'Відновлення…' : 'Так, замінити'}
              </button>
              <button className="btn-ghost-sm" disabled={restoring} onClick={() => setPendingRestore(null)}>
                Скасувати
              </button>
            </div>
          )}
        </div>

        <div className="card manage-backup" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>📁 Копія на диск (Google Drive for Desktop)</h3>
          <p className="backup-hint">
            Той самий принцип, що в Геркулес Клуб: повний знімок бази пишеться файлом
            у обрану папку на диску (напр. G:, синхронізований Google Drive for Desktop)
            — кожні {BACKUP_INTERVAL_MIN} хв, при закритті зміни і при закритті вкладки.
            Зберігаються останні {BACKUP_KEEP} файлів. Без інтернету, без токенів.
          </p>

          {!localState ? null : (
            <>
              <p className={formatLocalBackupStatus(localState).stale ? 'status-deny' : 'status-ok'}>
                {formatLocalBackupStatus(localState).text}
              </p>
              <p className="backup-hint">
                {localState.configured
                  ? `Папка: ${getLocalBackupFolderName() || '(без назви)'}${localState.lastError ? ' · ' + localState.lastError : ''}`
                  : 'Папка ще не вказана.'}
              </p>
              <div className="manage-backup-actions">
                {!localState.configured || !localState.permissionOk ? (
                  <button className="btn-primary" onClick={async () => {
                    try { await (localState.configured ? reconfirmLocalBackupPermission() : pickLocalBackupFolder()) }
                    catch (err) { localAlert(err.message) }
                  }}>
                    {localState.configured ? 'Вказати папку заново' : 'Обрати папку бекапів'}
                  </button>
                ) : (
                  <>
                    <button className="btn-ghost" onClick={async () => {
                      const r = await writeLocalBackup()
                      if (!r.ok) localAlert('Не вдалося зробити бекап: ' + r.reason)
                    }}>Зробити бекап зараз</button>
                    <button className="btn-ghost" onClick={async () => {
                      try { await pickLocalBackupFolder() } catch (err) { localAlert(err.message) }
                    }}>Змінити папку</button>
                  </>
                )}
              </div>
              {localAlerts.map((a) => <p key={a.id} className="error-msg" style={{ marginTop: 8 }}>{a.message}</p>)}
            </>
          )}
        </div>

        <div className="card manage-backup" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>☁️ Хмарні снапшоти (Google Drive) + Telegram-звіти</h3>
          <p className="backup-hint">
            Повний знімок бази автоматично летить у папку вашого Google Drive при
            кожному закритті зміни (офлайн — досилається при появі мережі).
            Якщо на проксі задано Telegram-бота (BOT_TOKEN + CHAT_ID) — по
            закінченню зміни (з часом відкриття й підсумком закриття) додатково
            шлеться звіт у Telegram, з поміткою «ГЕРКУЛЕС ШОП».
            Налаштування проксі — див. файл <code>gerkules-snapshot-proxy.gs</code>.
          </p>

          <div className="manage-form-row">
            <input
              type="url"
              placeholder="URL веб-додатку Apps Script (…/exec)"
              value={snapUrl}
              onChange={e => setSnapUrl(e.target.value)}
            />
          </div>
          <div className="manage-form-row">
            <input
              type="password"
              placeholder="Секретний токен (SECRET_TOKEN зі Script Properties)"
              value={snapToken}
              onChange={e => setSnapToken(e.target.value)}
            />
          </div>

          <div className="manage-backup-actions">
            <button className="btn-ghost" onClick={handleSaveSnapshotSettings} disabled={!config}>
              Зберегти налаштування
            </button>
            <button
              className="btn-primary"
              onClick={handleSendNow}
              disabled={snapshotting || !snapUrl.trim() || !snapToken.trim()}
            >
              {snapshotting ? 'Надсилаємо…' : 'Надіслати снапшот зараз'}
            </button>
          </div>

          {snapMsg && <p className="stat-value green" style={{ fontSize: '0.9rem', marginTop: 8 }}>{snapMsg}</p>}
          {snapErr && <p className="error-msg" style={{ marginTop: 8 }}>{snapErr}</p>}

          <p className="backup-hint" style={{ marginTop: 10 }}>
            Останній успішний снапшот: {snapStatus.lastOkAt ? fmtDateTime(snapStatus.lastOkAt) : 'ще не було'}
            {snapStatus.pending && ' · ⏳ є ненадісланий — повториться при появі мережі'}
          </p>
          <p className="backup-hint">
            Захист сховища браузером:{' '}
            {persisted === null ? 'невідомо' : persisted
              ? '✅ увімкнено (браузер не витіснить дані)'
              : '⚠️ не гарантовано — браузер може стерти дані під тиском місця, робіть бекапи'}
          </p>
        </div>

        <div className="card manage-backup danger-zone" style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8, color: 'var(--c-danger)' }}>⚠️ Нова точка на цьому пристрої</h3>
          <p className="backup-hint">
            Повністю очищує базу цього пристрою — категорії, товари, чеки, зміни, поставки і
            налаштування точки (назва/касири/хмара). Каса перезавантажиться на екран першого
            запуску, ніби це щойно розпакований пристрій. Використовуйте лише при переведенні
            цього пристрою на нову торгову точку — <strong>дію неможливо скасувати</strong>, зробіть бекап заздалегідь.
          </p>

          {!resetConfirming ? (
            <button className="btn-ghost" style={{ color: 'var(--c-danger)' }} onClick={() => setResetConfirming(true)}>
              Очистити базу…
            </button>
          ) : (
            <div className="manage-backup" style={{ gap: 10 }}>
              <div className="manage-form-row">
                <input
                  type="text"
                  placeholder={`Введіть «${config?.locationName ?? ''}» для підтвердження`}
                  value={resetTypedName}
                  onChange={e => setResetTypedName(e.target.value)}
                />
              </div>
              {resetError && <p className="error-msg">{resetError}</p>}
              <div className="manage-backup-actions">
                <button
                  className="btn-danger"
                  disabled={resetting || resetTypedName.trim() !== (config?.locationName ?? '').trim()}
                  onClick={handleResetDatabase}
                >
                  {resetting ? 'Очищення…' : 'Так, стерти все безповоротно'}
                </button>
                <button
                  className="btn-ghost-sm"
                  disabled={resetting}
                  onClick={() => { setResetConfirming(false); setResetTypedName(''); setResetError(null) }}
                >
                  Скасувати
                </button>
              </div>
            </div>
          )}
        </div>

    </div>
  )
}
