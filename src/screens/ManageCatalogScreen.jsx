import { useState, useEffect, useMemo, useRef } from 'react'
import { getCategories, getProducts, createProduct, updateProduct, deleteProduct, exportBackup, importBackup } from '../db.js'

function fmtDateTime(ts) {
  return new Date(ts).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function ManageCatalogScreen({ onBack }) {
  const [categories, setCategories] = useState([])
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [confirmingId, setConfirmingId] = useState(null)
  const [error, setError] = useState(null)

  const [form, setForm] = useState({ cat: '', name: '', price: '', stock: '' })

  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', price: '', stock: '' })
  const [editError, setEditError] = useState(null)

  const [backupError, setBackupError] = useState(null)
  const [pendingRestore, setPendingRestore] = useState(null)
  const [restoring, setRestoring] = useState(false)
  const backupFileInputRef = useRef(null)

  async function load() {
    const [cats, prods] = await Promise.all([getCategories(), getProducts()])
    setCategories(cats)
    setProducts(prods)
    setForm(f => ({ ...f, cat: f.cat || cats[0]?.id || '' }))
  }

  useEffect(() => { load() }, [])

  const catName = (id) => categories.find(c => c.id === id)?.name ?? id

  const displayed = useMemo(() => {
    if (!search.trim()) return products
    const q = search.trim().toLowerCase()
    return products.filter(p => p.name.toLowerCase().includes(q))
  }, [products, search])

  async function handleAdd(e) {
    e.preventDefault()
    setError(null)

    const name = form.name.trim()
    const price = Number(form.price)
    const stock = form.stock === '' ? 0 : Number(form.stock)

    if (!form.cat) return setError('Оберіть категорію')
    if (!name) return setError('Вкажіть назву товару')
    if (!price || price <= 0) return setError('Вкажіть коректну ціну')
    if (stock < 0 || !Number.isFinite(stock)) return setError('Вкажіть коректний залишок')

    try {
      await createProduct({ cat: form.cat, name, price, stock })
      setForm(f => ({ ...f, name: '', price: '', stock: '' }))
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    setError(null)
    try {
      await deleteProduct(id)
      setConfirmingId(null)
      await load()
    } catch (err) {
      setError(err.message)
      setConfirmingId(null)
    }
  }

  function startEdit(p) {
    setEditingId(p.id)
    setEditForm({ name: p.name, price: String(p.price), stock: String(p.stock) })
    setEditError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditError(null)
  }

  async function handleSaveEdit(id) {
    setEditError(null)

    const name = editForm.name.trim()
    const price = Number(editForm.price)
    const stock = Number(editForm.stock)

    if (!name) return setEditError('Вкажіть назву товару')
    if (!price || price <= 0) return setEditError('Вкажіть коректну ціну')
    if (stock < 0 || !Number.isFinite(stock)) return setEditError('Вкажіть коректний залишок')

    try {
      await updateProduct(id, { name, price, stock })
      setEditingId(null)
      await load()
    } catch (err) {
      setEditError(err.message)
    }
  }

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
        <h1>ГЕРКУЛЕС ШОП · Товари</h1>
        <div style={{ width: 80 }} />
      </header>

      <div className="manage-body">

        <section className="card manage-backup">
          <h2>Бекап бази</h2>
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
        </section>

        <form className="manage-add-form card" onSubmit={handleAdd}>
          <h2>Додати товар</h2>

          <div className="manage-form-row">
            <select
              value={form.cat}
              onChange={e => setForm(f => ({ ...f, cat: e.target.value }))}
            >
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
              ))}
            </select>
          </div>

          <div className="manage-form-row">
            <input
              type="text"
              placeholder="Назва товару"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>

          <div className="manage-form-row manage-form-row-split">
            <input
              type="number"
              min="0"
              step="1"
              placeholder="Ціна, ₴"
              value={form.price}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
            />
            <input
              type="number"
              min="0"
              step="1"
              placeholder="Залишок, шт"
              value={form.stock}
              onChange={e => setForm(f => ({ ...f, stock: e.target.value }))}
            />
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" className="btn-primary btn-full">Додати товар</button>
        </form>

        <div className="search-bar">
          <input
            type="search"
            placeholder="Пошук товару…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {displayed.length === 0
          ? <p className="empty-hint">Товарів не знайдено</p>
          : (
            <ul className="manage-list">
              {displayed.map(p => (
                <li key={p.id} className="manage-item card">
                  {editingId === p.id ? (
                    <div className="manage-edit-form">
                      <div className="manage-form-row">
                        <input
                          type="text"
                          placeholder="Назва товару"
                          value={editForm.name}
                          onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                        />
                      </div>
                      <div className="manage-form-row manage-form-row-split">
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="Ціна, ₴"
                          value={editForm.price}
                          onChange={e => setEditForm(f => ({ ...f, price: e.target.value }))}
                        />
                        <input
                          type="number"
                          min="0"
                          step="1"
                          placeholder="Залишок, шт"
                          value={editForm.stock}
                          onChange={e => setEditForm(f => ({ ...f, stock: e.target.value }))}
                        />
                      </div>
                      {editError && <p className="error-msg">{editError}</p>}
                      <div className="manage-edit-actions">
                        <button className="btn-primary" onClick={() => handleSaveEdit(p.id)}>Зберегти</button>
                        <button className="btn-ghost-sm" onClick={cancelEdit}>Скасувати</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="manage-item-info">
                        <span className="manage-item-name">{p.name}</span>
                        <span className="manage-item-meta">
                          {catName(p.cat)} · {p.price.toLocaleString('uk-UA')} ₴ · {p.stock} шт
                        </span>
                      </div>

                      {confirmingId !== p.id ? (
                        <div className="manage-item-actions">
                          <button className="btn-ghost-sm" onClick={() => startEdit(p)}>
                            Редагувати
                          </button>
                          <button
                            className="btn-ghost-sm"
                            style={{ color: 'var(--c-danger)' }}
                            onClick={() => setConfirmingId(p.id)}
                          >
                            Видалити
                          </button>
                        </div>
                      ) : (
                        <div className="cancel-confirm">
                          <span>Видалити «{p.name}»?</span>
                          <button className="btn-danger" style={{ minHeight: 36, padding: '6px 14px' }} onClick={() => handleDelete(p.id)}>
                            Так
                          </button>
                          <button className="btn-ghost-sm" onClick={() => setConfirmingId(null)}>
                            Ні
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )
        }

      </div>
    </div>
  )
}
