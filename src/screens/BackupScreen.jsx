import { useState, useRef } from 'react'
import { exportBackup, importBackup } from '../db.js'

function fmtDateTime(ts) {
  return new Date(ts).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function BackupScreen({ onBack }) {
  const [backupError, setBackupError] = useState(null)
  const [pendingRestore, setPendingRestore] = useState(null)
  const [restoring, setRestoring] = useState(false)
  const backupFileInputRef = useRef(null)

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
            Зберігає й відновлює каталог, залишки та всю історію чеків одним файлом —
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

      </div>
    </div>
  )
}
