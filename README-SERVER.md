# DNA OS AI Server — Portable Runtime (Phase 3)

Standalone compute runtime for **DNA OS Remote Compute** (вision: run AI
inference, code read, build & test on a private Windows/Linux box, driven by
the Business server whose relay lives in `app/api/admin/devices/compute-relay`).

**Target hardware (mission):** Windows 11 · AMD Radeon RX 9070 XT 16 GB · 32 GB RAM · 1 TB SSD.
**Auth model:** bearer token pairing (generated per install); **no Production credentials ever**; **public port stays closed** (loopback default); **LAN = manual opt-in**.

## Install (Windows 11, PowerShell as Admin)

```powershell
# 1) unzip the portable package anywhere on the dedicated SSD
cd dna-os-ai-server\dna-os-compute
# 2) bootstrap deps + build runtime + probe GPU (AMD RX 9070 XT should show)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\install-deps.ps1
# 3) pair once — prints the token to give the Business server
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pair.ps1
# 4) start (binding 127.0.0.1; LAN only with manual firewall rule)
$env:DNA_COMPUTE_TOKEN="<token from pair.ps1>"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start.ps1
# 5) verify
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\health.ps1
```

## Install (Linux / cloud VM)

```bash
cd dna-os-compute
bash scripts/install-deps.sh     # node>=20, tsc+tsx local, rocm-smi probe
bash scripts/pair.sh
DNA_COMPUTE_TOKEN=<token> bash scripts/start.sh
bash scripts/health.sh
```

## Business server side (macOS)

```bash
export DNA_COMPUTE_DAEMON_URL="http://<server-ip>:<port>"   # or 127.0.0.1 same-host
export DNA_COMPUTE_TOKEN="<token from pair>"
```
Then the existing relay performs its six-step lifecycle for each command.

## Uninstall (Windows)

Stop the daemon (`scripts\stop.ps1`), delete the unzipped folder, remove any
manual firewall rule. Nothing is installed system-wide (all deps live inside
`dna-os-compute\node_modules`), so folder deletion = clean uninstall.

## Security posture (why this package is safe by default)

- binds **127.0.0.1 only**; never calls `netsh`/firewall itself (LAN = manual).
- **no secrets inside**: build refuses `SUPABASE_/RAILWAY_/API_KEY/...` shapes.
- token = 24+ random bytes; timing-safe compare in the daemon; never logged.
- file access = deny-by-exclusion inside the granted workspace root only.
- child processes get a **whitelisted env** (never inherit the host env).
- code execution = static allowlist of npm script names; fixed argv; timeout.
- GPU detection = read-only OS queries (Win32_VideoController / rocm-smi).
