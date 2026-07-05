# ГЕРКУЛЕС ШОП — Каса: розгортання застосунку на новому ПК.
# Перевіряє наявність Node.js/npm, ставить Node.js через winget, якщо
# його немає, і встановлює npm-залежності проєкту (npm install).
#
# Запуск: подвійний клік на install.bat (у цій же папці),
# або вручну:  powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "OK: $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "УВАГА: $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "ПОМИЛКА: $msg" -ForegroundColor Red }
function Stop-WithPause($code) {
    Read-Host "`nНатисніть Enter, щоб закрити"
    exit $code
}

Write-Host "========================================================"
Write-Host "  ГЕРКУЛЕС ШОП — Каса: встановлення залежностей"
Write-Host "========================================================"

# ── 1. Node.js ────────────────────────────────────────────────
Write-Step "Перевірка Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue

if (-not $node) {
    Write-Warn "Node.js не знайдено на цьому ПК."
    $winget = Get-Command winget -ErrorAction SilentlyContinue

    if ($winget) {
        Write-Host "Встановлюю Node.js LTS через winget (потрібен інтернет)..."
        winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements

        # winget оновлює PATH для нових вікон термінала, але не для вже
        # відкритого — підключаємо типове розташування вручну в цій сесії.
        $nodeDir = Join-Path $Env:ProgramFiles 'nodejs'
        if (Test-Path (Join-Path $nodeDir 'node.exe')) {
            $Env:PATH = "$nodeDir;$Env:PATH"
        }
        $node = Get-Command node -ErrorAction SilentlyContinue
    } else {
        Write-Err "Менеджер winget недоступний на цьому ПК."
    }

    if (-not $node) {
        Write-Err "Не вдалося встановити Node.js автоматично."
        Write-Host "Встановіть вручну: https://nodejs.org (кнопка ""LTS""),"
        Write-Host "після встановлення запустіть цей скрипт ще раз."
        Stop-WithPause 1
    }
    Write-Ok "Node.js встановлено."
} else {
    Write-Ok "Node.js знайдено: $($node.Source)"
}

# ── 2. Версія Node.js ─────────────────────────────────────────
$nodeVersion  = (node -v) -replace '^v', ''
$majorVersion = [int]($nodeVersion.Split('.')[0])
if ($majorVersion -lt 18) {
    Write-Warn "Версія Node.js $nodeVersion застаріла (потрібно 18 або новіше)."
    Write-Warn "Рекомендую оновити: https://nodejs.org (кнопка ""LTS"")."
} else {
    Write-Ok "Версія Node.js: $nodeVersion"
}

# ── 3. npm ────────────────────────────────────────────────────
Write-Step "Перевірка npm"
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
    Write-Err "npm не знайдено (мав встановитись разом з Node.js)."
    Write-Host "Перевстановіть Node.js з https://nodejs.org і запустіть скрипт знову."
    Stop-WithPause 1
}
Write-Ok "npm знайдено: $(npm -v)"

# ── 4. Залежності проєкту ─────────────────────────────────────
Write-Step "Перевірка залежностей проєкту"
Set-Location $root

$nodeModules = Join-Path $root 'node_modules'
if (-not (Test-Path $nodeModules)) {
    Write-Host "Папка node_modules відсутня — встановлюю залежності (потрібен інтернет)..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Err "npm install завершився з помилкою."
        Write-Host "Перевірте інтернет-з'єднання і запустіть скрипт ще раз."
        Stop-WithPause 1
    }
    Write-Ok "Залежності встановлено."
} else {
    Write-Ok "Залежності вже встановлені (node_modules знайдено)."
    Write-Host "Якщо після оновлення файлів проєкту щось не працює —"
    Write-Host "видаліть папку node_modules і запустіть цей скрипт знову."
}

Write-Host "`n========================================================"
Write-Host "  Готово! Для запуску каси використовуйте install\run.bat"
Write-Host "========================================================"
Stop-WithPause 0
