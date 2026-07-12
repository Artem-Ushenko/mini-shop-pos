import { useState, useEffect, useRef } from 'react'
import { exportBackup, importBackup, getConfig, setConfig } from '../db.js'
import { sendSnapshot, getSnapshotStatus } from '../cloud.js'

function fmtDateTime(ts) {
  return new Date(ts).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function BackupScreen({ onBack }) {
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

  async function handleSaveSnapshotSettings() {
    setSnapErr(null)
    setSnapMsg(null)
    try {
      const updated = await setConfig({
        ...config,
        snapshot: { url: snapUrl.trim(), token: snapToken.trim() },
      })
      setConfigState(updated)
      setSnapMsg('Налаштування збережено')
    } catch (err) {
      setSnapErr(err.message)
    }
  }

  async function handleSendNow() {
    setSnapErr(null)
    setSnapMsg(null)
    setSnapshotting(true)
    try {
      const res = await sendSnapshot()
      setSnapMsg(`Снапшот на Drive: ${res.file}`)
    } catch (err) {
      setSnapErr(err.message)
    } finally {
      setSnapshotting(false)
      setSnapStatus(getSnapshotStatus())
    }
  }

  return (
    <div className="manage-layout">

      <header className="app-header">
        <button className="btn-ghost" onClick={onBack}>← Назад</button>
        <h1>ГЕРКУЛЕС ШОП · Бекапи</h1>
        <div style={{ width: 80 }} />
      </header>

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
          <h3 style={{ marginBottom: 8 }}>☁️ Хмарні снапшоти (Google Drive) + Telegram-звіти</h3>
          <p className="backup-hint">
            Повний знімок бази автоматично летить у папку вашого Google Drive при
            кожному закритті зміни (офлайн — досилається при появі мережі).
            Якщо на проксі задано Telegram-бота (BOT_TOKEN + CHAT_ID) — відкриття
            і закриття зміни додатково шлють звіт у Telegram.
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

      </div>
    </div>
  )
}
