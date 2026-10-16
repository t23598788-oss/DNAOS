# DNA OS AI Server — start (Phase 3, 2026-10-16)
# Binds 127.0.0.1 ONLY by default; never opens a public port by itself.
# Requires DNA_COMPUTE_TOKEN (owner choice); never ships one inside the package.
# Usage: $env:DNA_COMPUTE_TOKEN="<token>"; powershell -File scripts\start.ps1
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
Set-Location $root

if (-not $env:DNA_COMPUTE_TOKEN) {
  Write-Error "DNA_COMPUTE_TOKEN is required before start (no token = no /commands). Generate once with: [guid]::NewGuid().ToString('N')"
  exit 1
}
if (-not (Test-Path "dist\daemon.js")) {
  Write-Error "dist/daemon.js missing — run scripts\install-deps.ps1 first."
  exit 1
}
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$log = Join-Path $logDir "daemon-$stamp.log"

Write-Host "starting daemon on 127.0.0.1 (public port stays CLOSED) — log: $log"
$proc = Start-Process -FilePath "node" -ArgumentList "dist\server-entry.js" -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
if ($proc.HasExited) { Write-Error "daemon exited immediately — see $log.err"; exit 1 }
$proc.Id | Set-Content (Join-Path $logDir "daemon.pid")
Get-Content $log -Tail 3 | ForEach-Object { Write-Host $_ }
Write-Host "START OK pid=$($proc.Id) — remember to run scripts\pair.ps1 to pair with DNA OS (macBook) over the private network."
