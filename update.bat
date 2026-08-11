@echo off
chcp 65001 >nul
title Геркулес Шоп — оновлення
setlocal
cd /d "%~dp0"

echo.
echo   ГЕРКУЛЕС ШОП — оновлення застосунку
echo   -------------------------------------
echo.
echo   Перед оновленням закрийте вікно каси ^(start-desk.bat^),
echo   щоб не працювати з файлами, поки вони змінюються.
echo.
pause

echo.
echo   [1/3] Отримання оновлень з GitHub...
git pull
if errorlevel 1 (
  echo.
  echo   ! Не вдалося отримати оновлення. Перевірте інтернет-зʼєднання
  echo   ! або зверніться до розробника.
  echo.
  pause
  exit /b 1
)

echo.
echo   [2/3] Перевірка залежностей...
call npm install --no-fund --no-audit
if errorlevel 1 (
  echo.
  echo   ! npm install завершився з помилкою.
  echo.
  pause
  exit /b 1
)

echo.
echo   [3/3] Пробна збірка ^(щоб зловити помилку зараз, а не при запуску^)...
call npm run build
if errorlevel 1 (
  echo.
  echo   ! Збірка не вдалася. Зверніться до розробника — не запускайте
  echo   ! start-desk.bat, поки це не виправлено.
  echo.
  pause
  exit /b 1
)

echo.
echo   Готово. Оновлення застосовано.
echo   Запустіть start-desk.bat ^(або перезавантажте ПК^), щоб продовжити роботу.
echo.
pause
endlocal
