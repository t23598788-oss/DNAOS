# DNA OS AI Server — stop (Phase 3, 2026-10-16)
# Graceful stop by PID captured at start; refuses to kill arbitrary processes.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
Set-Location $root
$pidFile = Join-Path $root "logs\daemon.pid"
if (-not (Test-Path $pidFile)) { Write-Host "no daemon.pid — nothing to stop"; exit 0 }
$daemonPid = [int](Get-Content $pidFile)
$proc = Get-Process -Id $daemonPid -ErrorAction SilentlyContinue
if (-not $proc) { Write-Host "pid $daemonPid not running (stale pid file) — removing"; Remove-Item $pidFile -Force; exit 0 }
if ($proc.ProcessName -ne "node") { Write-Error "pid $daemonPid is not a node process (refusing to kill)"; exit 1 }
Stop-Process -Id $daemonPid -Force
Remove-Item $pidFile -Force
Write-Host "STOP OK (pid $daemonPid)"
