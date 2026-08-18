import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// immediate: true — перевірка й перезавантаження на новий білд одразу при
// старті кіоску, а не після якогось невизначеного пізнішого тригера.
// Дивись коментар у vite.config.js (injectRegister: null) — чому це потрібно.
registerSW({ immediate: true })
