@echo off
rem Starts the web app in demo mode (sample data, no server, no sign-in) on port 5174. Development only.
cd /d "%~dp0"
set VITE_AUTH_MOCK=1
"C:\Program Files\nodejs\node.exe" node_modules\vite\bin\vite.js --port 5174
