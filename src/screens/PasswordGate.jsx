import { useState } from 'react'

// Універсальний пароль-екран: вхід у касу (без onBack) і адмін-доступ
// до окремих екранів (з onBack). Запам'ятовування розблокування — на боці
// батьківського компонента через onUnlock.
//
// Порівнюється SHA-256-хеш введеного пароля з correctHash: у публічний
// JS-бандл потрапляє лише хеш, а не відкритий текст пароля.
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export default function PasswordGate({ correctHash, onUnlock, onBack, hint = 'Введіть пароль для входу в касу' }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setChecking(true)
    try {
      if ((await sha256Hex(value)) === correctHash) {
        onUnlock()
      } else {
        setError(true)
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="gate-screen">
      <form className="card gate-card" onSubmit={handleSubmit}>
        <h1>ГЕРКУЛЕС ШОП</h1>
        <p className="gate-hint">{hint}</p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={e => { setValue(e.target.value); setError(false) }}
          placeholder="Пароль"
        />
        {error && <p className="error-msg">Невірний пароль</p>}
        <button type="submit" className="btn-primary btn-full" disabled={checking}>Увійти</button>
        {onBack && (
          <button type="button" className="btn-ghost" onClick={onBack}>← Назад</button>
        )}
      </form>
    </div>
  )
}
