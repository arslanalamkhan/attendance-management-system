<#
.SYNOPSIS
  Export the attendance database from this Windows PC so it can be restored on the Linux server.

.DESCRIPTION
  Writes a pg_dump custom-format file (all employees, punches, photos, templates, users, roles and the audit log)
  to .backup\db\. Copy it to the server and pass it to install.sh --restore (or "nacta-attendance restore").

  Stop the app on this PC first (-StopServer does it) so no punches land here after the export. Punches made while
  the device is being moved stay on the terminal and upload to the new server when it connects.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\windows\export-database.ps1 -StopServer
#>
param(
  [switch]$StopServer,
  [string]$PgBin = ''
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')

if (-not $PgBin) {
  $PgBin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Name -replace '\D', '') } -Descending |
    ForEach-Object { Join-Path $_.FullName 'bin' } |
    Where-Object { Test-Path (Join-Path $_ 'pg_dump.exe') } |
    Select-Object -First 1
}
if (-not $PgBin) { throw 'pg_dump.exe not found; pass -PgBin "C:\Program Files\PostgreSQL\18\bin"' }

# DATABASE_URL from server\.env (never printed).
$line = Get-Content (Join-Path $root 'server\.env') | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $line) { throw 'DATABASE_URL not found in server\.env' }
$uri = [Uri](($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"'))
$user, $pass = $uri.UserInfo.Split(':', 2)
$env:PGHOST = $uri.Host
$env:PGPORT = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
$env:PGUSER = [Uri]::UnescapeDataString($user)
$env:PGPASSWORD = [Uri]::UnescapeDataString($pass)
$db = $uri.AbsolutePath.TrimStart('/')

if ($StopServer) {
  $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -match 'dist[\\/]index\.js' -or $_.CommandLine -match 'vite' }
  foreach ($p in $procs) {
    Write-Host "Stopping $($p.ProcessId): $($p.CommandLine)"
    Stop-Process -Id $p.ProcessId -Force
  }
}

$outDir = Join-Path $root '.backup\db'
New-Item -ItemType Directory -Force $outDir | Out-Null
$out = Join-Path $outDir ("attendance-for-linux-{0}.dump" -f (Get-Date -Format 'yyyyMMdd-HHmm'))

Write-Host "Exporting database '$db' ..."
& (Join-Path $PgBin 'pg_dump.exe') --format=custom --no-owner --no-acl --dbname=$db --file=$out
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed ($LASTEXITCODE)" }

$counts = & (Join-Path $PgBin 'psql.exe') -X -At -d $db -c "SELECT count(*) FROM employees" -c "SELECT count(*) FROM attendance_logs"
Remove-Item Env:PGPASSWORD

$size = '{0:N0} MB' -f ((Get-Item $out).Length / 1MB)
Write-Host ''
Write-Host "Done: $out ($size)"
Write-Host "Contains $($counts[0]) employees and $($counts[1]) punches."
Write-Host ''
Write-Host 'Copy it to the server, for example:'
Write-Host "  scp `"$out`" <user>@<server-ip>:/tmp/attendance.dump"
