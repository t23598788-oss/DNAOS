# DNA OS AI Server — health check (Phase 3, 2026-10-16)
# Probes the daemon health + live resource metering. Read-only, no writes.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$portArg = $args[0]
if (-not $portArg) {
  $env:DNA_COMPUTE_PORT_LOG = $null
  # default: read the latest READY line from logs if no explicit port
  $latest = Get-ChildItem (Join-Path $root "logs") -Filter "daemon-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($latest) {
    $ready = Select-String -Path $latest.FullName -Pattern "DNA_COMPUTE_READY port=(\d+)" | Select-Object -Last 1
    if ($ready) { $portArg = $ready.Matches[0].Groups[1].Value }
  }
}
if (-not $portArg) { Write-Error "no daemon port known — pass a port or start the daemon first (scripts\start.ps1)"; exit 1 }
$base = "http://127.0.0.1:$portArg"

$h = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 5
Write-Host ("health: {0}  runtime={1}" -f $h.ok, $h.heartbeat.runtime)
$h.heartbeat.capabilities | ConvertTo-Json -Compress | Out-Host

if ($env:DNA_COMPUTE_TOKEN) {
  $headers = @{ Authorization = "Bearer $env:DNA_COMPUTE_TOKEN" }
  $m = Invoke-RestMethod -Uri "$base/metering" -Headers $headers -TimeoutSec 20
  $m.metering.cpu | Format-List | Out-Host
  $m.metering.ram  | Format-List | Out-Host
  Write-Host ("gpu adapter: {0} status={1}" -f $m.metering.gpu.adapter, $m.metering.gpu.status)
  $m.metering.gpu.gpus | Format-Table | Out-Host
} else {
  Write-Host "(set DNA_COMPUTE_TOKEN to also probe /metering GPU/CPU/RAM numbers)"
}
Write-Host "HEALTH OK"
