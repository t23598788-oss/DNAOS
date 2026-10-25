# DNA OS AI Server — Windows dependency bootstrap (Phase 3, 2026-10-16)
# Installs ONLY into the portable runtime directory (never system-wide),
# never touches any repository outside the package, never reads or writes
# any Production credential, and never opens a public port.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-deps.ps1
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Join-Path (Split-Path -Parent $here) ""   # dna-os-compute/
Set-Location $root

Write-Host "== DNA OS AI Server dependency bootstrap (Windows) =="

# 1. Node >= 20 required (target machine: Windows 11 + Node 22 OK)
$nodeVersion = $null
try { $nodeVersion = ([int](node -v | ForEach-Object { $_.Substring(1).Split(".")[0] })) } catch { }
if (-not $nodeVersion -or $nodeVersion -lt 20) {
  Write-Error "Node.js >= 20 is required. Install from https://nodejs.org (LTS)."
  exit 1
}
Write-Host "node: $(node -v)"

# 2. TypeScript + tsx INSIDE the runtime dir only (no -g install anywhere).
if (-not (Test-Path "node_modules\.bin\tsc.cmd")) {
  Write-Host "installing typescript/tsx/types (local .) ..."
  & npm install --no-audit --no-fund typescript@^5.7 tsx@^4.19 "@types/node@^22" 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Error "npm install failed"; exit 1 }
}

# 3. Build the runtime (tsc emit dist/)
Write-Host "building dist/ ..."
& cmd /c "node_modules\.bin\tsc.cmd -p ." 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Error "tsc failed"; exit 1 }
if (-not (Test-Path "dist\daemon.js")) { Write-Error "dist/daemon.js missing after build"; exit 1 }

# 4. GPU detection probe (AMD RX 9070 XT target: read-only CIM query).
Write-Host "probing GPU (Win32_VideoController) ..."
$gpus = Get-CimInstance Win32_VideoController | Select-Object Name, AdapterCompatibility, DriverVersion, AdapterRAM
$gpus | Format-Table | Out-Host
$amd = $gpus | Where-Object { $_.AdapterCompatibility -match "AMD|ATI" }
if ($amd) { Write-Host "AMD GPU detected: $($amd.Name) (driver $($amd.DriverVersion))" }
else { Write-Warning "no AMD GPU visible via CIM — ai.infer capability stays fail-closed NOT_CONFIGURED until Ollama/endpoint is set up" }

# 5. Ollama presence probe (install is a SEPARATE owner decision; never auto-installed here)
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollama) { Write-Host "ollama found: $(ollama --version)" }
else { Write-Host "ollama NOT installed (optional). To enable ai.infer locally: install Ollama for Windows, then set DNA_COMPUTE_INFER_ENDPOINT=http://127.0.0.1:11434" }

Write-Host "INSTALL-DEPS OK — port remains CLOSED until scripts\start.ps1 is run with a token."
