# ГЕРКУЛЕС ШОП — Каса: запуск для щоденної роботи (npm run dev).
# Вікно термінала має лишатись відкритим, поки каса працює.
# Зупинити касу — Ctrl+C у цьому вікні.
#
# Запуск: подвійний клік на run.bat (у цій же папці),
# або вручну:  powershell -ExecutionPolicy Bypass -File run.ps1

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

$nodeModules = Join-Path $root 'node_modules'
if (-not (Test-Path $nodeModules)) {
    Write-Host "Залежності ще не встановлені." -ForegroundColor Yellow
    Write-Host "Спочатку запустіть install\install.bat, потім повторіть запуск каси."
    Read-Host "`nНатисніть Enter, щоб закрити"
    exit 1
}

# Каса вже запущена (порт 5173 зайнятий)? Другий сервер піднявся б на іншому
# порту — а це інше, порожнє сховище даних. Тому просто відкриваємо браузер.
$busy = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
    Write-Host "Каса вже запущена в іншому вікні (порт 5173 зайнятий)." -ForegroundColor Yellow
    Write-Host "Відкриваю браузер на http://localhost:5173 — другий запуск не потрібен."
    Start-Process "http://localhost:5173"
    Read-Host "`nНатисніть Enter, щоб закрити"
    exit 0
}

Write-Host "========================================================"
Write-Host "  ГЕРКУЛЕС ШОП — Каса запускається..."
Write-Host "  Браузер відкриється сам на http://localhost:5173"
Write-Host "  Щоб зупинити касу — натисніть Ctrl+C у цьому вікні."
Write-Host "========================================================"
Write-Host ""

$env:KASA_OPEN = '1'   # каже Vite відкрити браузер, коли сервер готовий
npm run dev

Read-Host "`nКасу зупинено. Натисніть Enter, щоб закрити"
