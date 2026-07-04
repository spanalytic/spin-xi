@echo off
rem Refresh World Cup data and redeploy the site.
rem   deploy.bat        - rebuild from existing match files + publish
rem   deploy.bat fetch  - fetch latest results first (runs master_update), then publish
cd /d "%~dp0"

if "%1"=="fetch" (
  pushd C:\Users\thoma\PyCharmMiscProject
  .venv\Scripts\python.exe -m orchestrator.master_update --league "World Cup" --skip-odds
  popd
)

C:\Users\thoma\PyCharmMiscProject\.venv\Scripts\python.exe build_data.py wc
git add -A
git commit -m "World Cup data refresh"
git push origin main
for /f %%i in ('git subtree split --prefix web HEAD') do set SPLIT=%%i
git push -f origin %SPLIT%:gh-pages
echo.
echo Deployed to https://spanalytic.github.io/spin-xi/
echo (GitHub Pages CDN can take a few minutes to refresh)
