@echo off
REM Crea la clave privada para firmar licencias (solo la primera vez o para rotarla).
where node >nul 2>nul || (echo Instala Node.js 18 o superior desde https://nodejs.org & pause & exit /b 1)
node "%~dp0crear-claves.mjs" %*
pause
