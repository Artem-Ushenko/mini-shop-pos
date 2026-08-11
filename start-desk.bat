@echo off
chcp 65001 >nul
title Геркулес Шоп — запуск робочої каси
setlocal

REM ═══════════════════════════════════════════════════════════
REM  Запуск каси на стійці магазину спортхарчування
REM  Той самий технічний стек і той самий принцип, що в
REM  сестринському проєкті екосистеми «Геркулес» (Геркулес Клуб,
REM  gym-POS/start-desk.bat): продакшн-збірка + локальний сервер
REM  (без dev-режиму) + окремий профіль Chrome у режимі
REM  застосунку (--app). Ставиться в Планувальник завдань
REM  "при вході в систему".
REM
REM  Без очікування Google Диска (крок є в Клубі) — бекап Шопу не
REM  прив'язаний до локально змонтованого диска: він або ручний
REM  (кнопка «Завантажити бекап»), або хмарний через HTTP-проксі
REM  (Бекапи → Хмарні снапшоти) — жодному з двох диск G: не
REM  потрібен.
REM ═══════════════════════════════════════════════════════════

REM ---- ЗАПОВНИТИ ПЕРЕД ЗАПУСКОМ -----------------------------
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "PROFILES=C:\Herkules\profiles"
REM 5173, НЕ інший порт: дані каси (IndexedDB) прив'язані до
REM localhost:5173 (CANONICAL_ORIGIN в src/App.jsx) — інший порт
REM тут покаже касиру банер «примарної каси» й порожню базу.
set "PORT=5173"
REM -----------------------------------------------------------

set "APP_DIR=%~dp0"
set "SHOP_URL=http://localhost:%PORT%/"

REM Позиція й розмір вікна — за замовчуванням на весь перший монітор.
set "WIN_X=0"
set "WIN_Y=0"
set "WIN_W=1900"
set "WIN_H=1040"

echo.
echo   ГЕРКУЛЕС ШОП — підготовка робочого місця
echo   ------------------------------------------
echo.

REM ── 1. Локальний сервер застосунку (build + preview) ────────
REM Той самий принцип, що в Геркулес Клуб: PWA і File System
REM Access API потребують secure context — просте відкриття
REM index.html з диска не підійде. Продакшн-режим: зібраний
REM dist/ (без HMR/source-map накладних витрат), не dev-сервер.
REM Пересобирається щоразу при старті.
echo   [1/2] Збірка застосунку...
if not exist "%APP_DIR%node_modules\.bin\vite.cmd" (
  echo.
  echo   ! Не знайдено node_modules\.bin\vite.cmd
  echo   ! Виконайте один раз: npm install ^(у папці застосунку^)
  echo.
  pause
  exit /b 1
)
call "%APP_DIR%node_modules\.bin\vite.cmd" build --logLevel warn
if errorlevel 1 (
  echo.
  echo   ! Збірка не вдалася — каса НЕ запущена.
  echo   ! Перевірте помилки вище або зверніться до розробника.
  echo.
  pause
  exit /b 1
)
echo   Запуск локального сервера (порт %PORT%)...
start "Herkules Shop Server" /min "%APP_DIR%node_modules\.bin\vite.cmd" preview --port %PORT% --strictPort
timeout /t 2 >nul

REM ── 2. Каса «Геркулес Шоп» ──────────────────────────────────
echo   [2/2] Запуск каси...
start "Shop" /ABOVENORMAL "%CHROME%" ^
  --user-data-dir="%PROFILES%\shop" ^
  --app="%SHOP_URL%" ^
  --window-position=%WIN_X%,%WIN_Y% ^
  --window-size=%WIN_W%,%WIN_H% ^
  --disable-background-timer-throttling ^
  --disable-backgrounding-occluded-windows ^
  --disable-renderer-backgrounding ^
  --disable-features=CalculateNativeWinOcclusion,TranslateUI ^
  --no-first-run ^
  --no-default-browser-check

echo.
echo   Готово. Каса запущена.
echo.
echo   Для оновлення застосунку — запустіть update.bat.
echo   НЕ відкривайте сторонні сайти у робочому вікні.
echo.
timeout /t 6 >nul
endlocal
