@echo off
cd /d "%~dp0"
if exist "release\Convertor.exe" (
    start "" "release\Convertor.exe"
    exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ". '.\scripts\env.ps1'; npm run desktop"
pause
