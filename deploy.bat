@echo off
rem Refresh Premier League data from the FPL API and redeploy the site.
rem   deploy.bat          - fetch the latest FPL stats, rebuild + publish
rem   deploy.bat offline  - rebuild from the FPL snapshots already in data\raw\2627 + publish
cd /d "%~dp0"

rem pick up any score refreshes the scheduled GitHub job has pushed
git pull --rebase origin main

if "%1"=="offline" (
  C:\Users\thoma\PyCharmMiscProject\.venv\Scripts\python.exe build_data.py fpl-transform
) else (
  C:\Users\thoma\PyCharmMiscProject\.venv\Scripts\python.exe build_data.py fpl
)
if errorlevel 1 exit /b 1
git add -A
git commit -m "Premier League data refresh"
git push origin main
for /f %%i in ('git subtree split --prefix web HEAD') do set SPLIT=%%i
git push -f origin %SPLIT%:gh-pages
echo.
echo Deployed to https://spanalytic.github.io/spin-xi/
echo (GitHub Pages CDN can take a few minutes to refresh)
