import { useState, useEffect } from 'react'
import { getTodayStats, getFullStats } from '../db.js'

const TODAY_REFRESH_MS = 5000   // дешево — індексований запит лише за сьогодні
const FULL_REFRESH_MS  = 60000  // дорожче — повний прохід по всій історії чеків

function fmt(n) {
  return Math.round(n).toLocaleString('uk-UA')
}

export default function StatsScreen({ onBack }) {
  const [stats, setStats] = useState(null)

  async function loadToday() {
    const today = await getTodayStats()
    setStats(s => ({ ...s, today }))
  }

  async function loadFull() {
    const full = await getFullStats()
    setStats(s => ({ ...s, ...full }))
  }

  useEffect(() => {
    loadToday()
    loadFull()
    const todayTimer = setInterval(loadToday, TODAY_REFRESH_MS)
    const fullTimer = setInterval(loadFull, FULL_REFRESH_MS)
    return () => { clearInterval(todayTimer); clearInterval(fullTimer) }
  }, [])

  if (!stats?.today || !stats?.stock) return <div className="loading-screen">Завантаження…</div>

  return (
    <div className="stats-layout">

      <header className="app-header">
        <button className="btn-ghost" onClick={onBack}>← Назад</button>
        <h1>ГЕРКУЛЕС ШОП · Статистика</h1>
        <div style={{ width: 80 }} />
      </header>

      <div className="stats-body">

        <section>
          <h2 className="stats-section-title">Сьогодні</h2>
          <div className="stats-grid">
            <div className="stat-tile card">
              <span className="stat-label">Виручка</span>
              <span className="stat-value green">{fmt(stats.today.sum)} ₴</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-label">Чеків</span>
              <span className="stat-value">{stats.today.count}</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-label">Середній чек</span>
              <span className="stat-value">{fmt(stats.today.avgCheck)} ₴</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-label">Сума знижок</span>
              <span className="stat-value">{fmt(stats.today.discountTotal)} ₴</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-label">Скасовано чеків</span>
              <span className="stat-value">{stats.today.cancelledCount}</span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="stats-section-title">За весь час</h2>
          <div className="stats-grid">
            <div className="stat-tile card">
              <span className="stat-label">Виручка</span>
              <span className="stat-value green">{fmt(stats.allTime.sum)} ₴</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-label">Чеків</span>
              <span className="stat-value">{stats.allTime.count}</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-label">Скасовано чеків</span>
              <span className="stat-value">{stats.allTime.cancelledCount}</span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="stats-section-title">Вартість товарних залишків</h2>
          <p className="stats-hint">Рахується наживо з поточної кількості й цін — оновлюється сама, поки екран відкритий.</p>
          <div className="stats-grid">
            <div className="stat-tile card">
              <span className="stat-label">За цінами продажу</span>
              <span className="stat-value green">{fmt(stats.stock.valueBySalePrice)} ₴</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-label">За собівартістю</span>
              <span className="stat-value">{fmt(stats.stock.valueByCostPrice)} ₴</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-label">Потенційний прибуток</span>
              <span className="stat-value green">{fmt(stats.stock.potentialProfit)} ₴</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-label">Товарів у каталозі</span>
              <span className="stat-value">{stats.stock.productsCount}</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-label">Категорій</span>
              <span className="stat-value">{stats.stock.categoriesCount}</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-label">Одиниць на складі</span>
              <span className="stat-value">{stats.stock.totalUnits}</span>
            </div>
            <div className="stat-tile card">
              <span className="stat-label">Немає в наявності</span>
              <span className="stat-value">{stats.stock.outOfStockCount}</span>
            </div>
          </div>
        </section>

        <section>
          <h2 className="stats-section-title">Топ-5 товарів</h2>
          {stats.topProducts.length === 0
            ? <p className="empty-hint">Продажів ще не було</p>
            : (
              <ol className="stats-top-list card">
                {stats.topProducts.map(p => (
                  <li key={p.id}>
                    <span>{p.name}</span>
                    <strong>{p.qty} шт</strong>
                  </li>
                ))}
              </ol>
            )
          }
        </section>

      </div>
    </div>
  )
}
