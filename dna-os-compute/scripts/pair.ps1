# DNA OS AI Server — device pairing (Phase 3, 2026-10-16)
# Generates a STRONG random pairing token ONCE, stores it in the runtime
# local config (never in the repository), prints the owner-side env snippet
# and the pairing readiness. LAN binding is OPT-IN and manual (this script
# never touches the firewall).
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
Set-Location $root

$token = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]]).Replace("+","-").Replace("/","_").TrimEnd("=")
$cfgDir = Join-Path $root "config"
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
$cfgPath = Join-Path $cfgDir "pairing.json"
@{
  token = $token
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  bindHost = "127.0.0.1"
  note = "LAN binding is opt-in: set DNA_COMPUTE_BIND_HOST explicitly AND add the firewall rule manually; this package never opens a public port automatically."
} | ConvertTo-Json | Set-Content $cfgPath -Encoding UTF8

Write-Host "PAIRING OK (stored at config\pairing.json — not in git)"
Write-Host ""
Write-Host "Owner-side (macOS Business server) env: "
Write-Host "  DNA_COMPUTE_TOKEN=$token"
Write-Host "  DNA_COMPUTE_DAEMON_URL=http://127.0.0.1:<port>   # same machine loopback, or"
Write-Host "                                       # http://<windows-ip>:<port> over the private network AFTER manual firewall opt-in"
Write-Host ""
Write-Host "Start the daemon afterwards: powershell -File scripts\start.ps1  (with:" '"$env:DNA_COMPUTE_TOKEN=..."' "already set)"
