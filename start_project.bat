@echo off
setlocal

REM ---- Set project root ----
set "PROJECT_ROOT=C:\Users\88ste\PycharmProjects\mung-studio-schenker"

REM ---- Frontend ----
start cmd /k "cd /d %PROJECT_ROOT% && npm start"

REM ---- Backend ----
start cmd /k "cd /d %PROJECT_ROOT%\simple-php-backend && php -S localhost:8080"

:waitloop
timeout /t 1 > nul
netstat -an | find "1234" > nul
if errorlevel 1 goto waitloop

start "" "http://localhost:1234"

endlocal