@echo off
chcp 65001 >nul
title Геркулес Шоп — запуск робочої каси
setlocal

REM ═══════════════════════════════════════════════════════════
REM  Запуск каси на стійці магазину спортхарчування
REM  Той самий принцип, що в сестринському проєкті екосистеми
REM  «Геркулес» (Геркулес Клуб, gym-POS/start-desk.bat):
REM  продакшн-збірка + локальний сервер (без dev-режиму) +
REM  окремий профіль Chrome у режимі застосунку (--app).
REM  Ставиться в Планувальник завдань "при вході в систему".
REM ═══════════════════════════════════════════════════════════

REM ---- ЗАПОВНИТИ ПЕРЕД ЗАПУСКОМ -----------------------------
set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "PROFILES=C:\Herkules\profiles"
set "PORT=8081"
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

REM ── 1. Збірка застосунку ────────────────────────────────────
REM Той самий принцип, що в Геркулес Клуб: File System Access API
REM (бекап) і взагалі PWA потребують secure context — просте
REM відкриття index.html з диска не підійде. Продакшн-режим:
REM зібраний dist/ (без HMR/source-map накладних витрат), не
REM dev-сервер. Пересобирається щоразу при старті.
echo   [1/3] Збірка застосунку...
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
echo   [2/3] Запуск каси...
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

echo   [3/3] Готово.
echo.
echo   Каса запущена. Для оновлення застосунку — запустіть update.bat.
echo   НЕ відкривайте сторонні сайти у робочому вікні.
echo.
timeout /t 6 >nul
endlocal
