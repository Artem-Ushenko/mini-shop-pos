import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    // Дані каси (IndexedDB) прив'язані до адреси localhost:5173 — якщо порт
    // зайнятий, чесно падаємо замість мовчки відкрити «порожню касу» на 5174.
    port: 5173,
    strictPort: true,
    // Браузер відкриває run.ps1 (ставить KASA_OPEN=1); тестові запуски — без вікна.
    open: Boolean(process.env.KASA_OPEN),
  },
  preview: {
    // Продакшн-запуск (start-desk.bat, той самий принцип, що в
    // сестринському проєкті — Геркулес Клуб): build + vite preview.
    // Той самий порт, що й dev (5173) — навмисно: дані каси (IndexedDB)
    // прив'язані до localhost:5173 (CANONICAL_ORIGIN в App.jsx). Інший
    // порт тут = «порожня» каса і банер «примарної каси» касиру.
    port: 5173,
    strictPort: true,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Кіоск перезбирається й переоткривається щодня (start-desk.bat), але
      // тримає той самий Chrome-профіль — старий service worker інакше й
      // далі обслуговує вчорашній JS-бандл. Дефолтний інжектований
      // registerSW.js лише реєструє SW і НІКОЛИ не перевіряє оновлення
      // (жодного registration.update()) — тому кіоск міг тижнями не бачити
      // нових збірок. injectRegister: null вимикає той дефолтний скрипт;
      // реальна реєстрація — в src/main.jsx через virtual:pwa-register,
      // де є явний update() і автоперезавантаження при новій версії.
      injectRegister: null,
      includeAssets: ['logo.svg', 'logo-192.png', 'logo-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Геркулес Шоп — Каса',
        short_name: 'Каса',
        description: 'Офлайн-каса магазину спортивного харчування Геркулес Шоп',
        lang: 'uk',
        theme_color: '#2456d6',
        background_color: '#f4f5f7',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'logo-192.png',        sizes: '192x192', type: 'image/png' },
          { src: 'logo-512.png',        sizes: '512x512', type: 'image/png' },
          { src: 'logo-512.png',        sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'logo.svg',            sizes: 'any',     type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // Кешуємо весь app-shell + catalog.csv (постійний шлях каталогу, потрібен офлайн)
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,csv}'],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
