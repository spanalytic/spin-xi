@echo off
rem Launch Spin XI: serve the web folder and open the browser
start "" http://localhost:8317
"C:\Users\thoma\PyCharmMiscProject\.venv\Scripts\python.exe" -m http.server 8317 --directory "%~dp0web"
