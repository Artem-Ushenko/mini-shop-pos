import { useState } from 'react'

export default function PasswordGate({ correctPassword, onUnlock }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)

  function handleSubmit(e) {
    e.preventDefault()
    if (value === correctPassword) {
      onUnlock()
    } else {
      setError(true)
    }
  }

  return (
    <div className="gate-screen">
      <form className="card gate-card" onSubmit={handleSubmit}>
        <h1>ГЕРКУЛЕС ШОП</h1>
        <p className="gate-hint">Введіть пароль для входу в касу</p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={e => { setValue(e.target.value); setError(false) }}
          placeholder="Пароль"
        />
        {error && <p className="error-msg">Невірний пароль</p>}
        <button type="submit" className="btn-primary btn-full">Увійти</button>
      </form>
    </div>
  )
}
