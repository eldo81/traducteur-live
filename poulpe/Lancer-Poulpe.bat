@echo off
chcp 65001 >nul
title Poulpe - laissez cette fenetre ouverte
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n est pas installe. Telechargez la version LTS sur https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules\playwright" (
  echo Premiere installation : 2 a 5 minutes, ne fermez pas cette fenetre...
  call npm install
  if errorlevel 1 (
    echo L installation a echoue. Faites une capture de cette fenetre.
    pause
    exit /b 1
  )
)
start "" cmd /c "timeout /t 4 >nul & start http://127.0.0.1:8787"
echo.
echo Poulpe demarre. Le navigateur va s ouvrir sur http://127.0.0.1:8787
echo Pour arreter Poulpe : fermez cette fenetre.
echo.
node src\cli.js serve
pause
