@echo off
REM Genera una licencia MipyPOS. Ejemplos:
REM   generar-licencia.bat --plan trial
REM   generar-licencia.bat --plan monthly --device ABCD-1234-EF56-7890 --customer "Tienda Ana"
REM   generar-licencia.bat --plan annual --customer "Cafeteria Luis" --out licencia.txt
setlocal
where node >nul 2>nul || (echo Instala Node.js 18 o superior desde https://nodejs.org & pause & exit /b 1)
if "%~1"=="" (
  set /p PLAN=Plan [trial/monthly/annual]: 
  set /p DEVICE=Codigo de dispositivo ^(Enter = cualquiera^): 
  set /p CUSTOMER=Cliente: 
  call :interactive
  goto :end
)
node "%~dp0generar-licencia.mjs" %*
goto :end
:interactive
set ARGS=--plan %PLAN% --out "%~dp0ultima-licencia.txt"
if not "%DEVICE%"=="" set ARGS=%ARGS% --device %DEVICE%
if not "%CUSTOMER%"=="" set ARGS=%ARGS% --customer "%CUSTOMER%"
node "%~dp0generar-licencia.mjs" %ARGS%
echo.
echo La licencia tambien se guardo en ultima-licencia.txt
exit /b 0
:end
pause
