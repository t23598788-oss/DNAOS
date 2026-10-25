# DNA OS AI Server — Windows Installer Build Pipeline (Phase 3, 2026-10-16)
# RUNS ON A WINDOWS HOST (authoring machine is macOS, so a real .exe/.msi here
# is NOT VERIFIED by design). Produces, in order of preference:
#   1. dna-os-ai-server Setup .exe via NSIS (makensis) when makensis is on PATH
#   2. portable runtime .zip (always available, no external tool needed)
# Never embeds secrets; never deploys; nothing is uploaded anywhere.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
Set-Location $root

# 0. Build the actual runtime first (tsc emit dist/) so the installer is real.
& cmd /c "node_modules\.bin\tsc.cmd -p ." 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Error "tsc failed before packaging"; exit 1 }

# 1. Portable zip (already cross-machine; verified on the build host)
& node scripts\build-portable.mjs
if ($LASTEXITCODE -ne 0) { Write-Error "portable build failed"; exit 1 }

# 2. NSIS: only when the toolchain exists (owner opt-in; otherwise keep zip)
$nsis = Get-Command makensis.exe -ErrorAction SilentlyContinue
if ($nsis) {
  $outDir = Join-Path $root "portable"
  & makensis "/DNOSRC=$root" "/DNOUT=$outDir" "packaging\\installer.nsi"
  if ($LASTEXITCODE -eq 0) { Write-Host "INSTALLER_BUILT $outDir\dna-os-ai-server-setup.exe" }
  else { Write-Warning "makensis failed — portable zip remains the artifact"; exit 1 }
} else {
  Write-Host "makensis.exe not found — output stays PORTABLE zip (installer .exe NOT VERIFIED on macOS authoring machine)."
  Write-Host "To produce the .exe: install NSIS 3.x on a Windows host or CI runner, then re-run this script."
}
