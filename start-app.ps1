# Starts the NACTA Attendance server (API :4000 + device ADMS :8081) and the web app (:5173)
# as background processes that keep running after this window closes. Safe to run again:
# anything already running is left alone. Logs: server\logs and client\logs.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = 'C:\Program Files\nodejs\node.exe'

function Test-Port([int]$port) {
  [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

if (Test-Port 4000) {
  Write-Host 'Server already running (ports 4000/8081).'
} else {
  if (-not (Test-Path "$root\server\dist\index.js")) { throw 'server\dist\index.js missing: run "npm --workspace server run build" first.' }
  New-Item -ItemType Directory -Force "$root\server\logs" | Out-Null
  Start-Process -FilePath $node -ArgumentList 'dist/index.js' -WorkingDirectory "$root\server" `
    -RedirectStandardOutput "$root\server\logs\server.out.log" -RedirectStandardError "$root\server\logs\server.err.log" -WindowStyle Hidden | Out-Null
  Write-Host 'Server started.'
}

if (Test-Port 5173) {
  Write-Host 'Web app already running (port 5173).'
} else {
  New-Item -ItemType Directory -Force "$root\client\logs" | Out-Null
  Start-Process -FilePath $node -ArgumentList 'node_modules\vite\bin\vite.js' -WorkingDirectory "$root\client" `
    -RedirectStandardOutput "$root\client\logs\vite.out.log" -RedirectStandardError "$root\client\logs\vite.err.log" -WindowStyle Hidden | Out-Null
  Write-Host 'Web app started.'
}

Start-Sleep -Seconds 5
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
Write-Host ''
Write-Host 'Open the app at:'
Write-Host '  http://localhost:5173  (this PC)'
foreach ($ip in $ips) { Write-Host "  http://${ip}:5173" }
