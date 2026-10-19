@echo off
cd /d "%~dp0"
if exist "Convertor.exe" (
    start "" "Convertor.exe" --web
    exit /b
)
if exist "release\Convertor.exe" (
    start "" "release\Convertor.exe" --web
    exit /b
)
echo Build Convertor first using scripts\build.ps1.
pause
