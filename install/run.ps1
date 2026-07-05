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

Write-Host "========================================================"
Write-Host "  ГЕРКУЛЕС ШОП — Каса запускається..."
Write-Host "  Коли з'явиться рядок ""Local:"" — відкрийте цю адресу"
Write-Host "  в браузері (Chrome або Edge)."
Write-Host "  Щоб зупинити касу — натисніть Ctrl+C у цьому вікні."
Write-Host "========================================================"
Write-Host ""

npm run dev

Read-Host "`nКасу зупинено. Натисніть Enter, щоб закрити"
