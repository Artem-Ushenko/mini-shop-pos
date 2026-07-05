import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.svg', 'logo-192.png', 'logo-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Геркулес Шоп — Каса',
        short_name: 'Каса',
        description: 'Офлайн-каса магазину спортивного харчування Геркулес Шоп',
        lang: 'uk',
        theme_color: '#2563eb',
        background_color: '#f1f5f9',
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
