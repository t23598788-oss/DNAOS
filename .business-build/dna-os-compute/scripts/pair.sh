#!/usr/bin/env bash
# DNA OS AI Server — device pairing (Linux, Phase 3). Strong random token,
# stored in runtime-local config only (never in git), LAN binding opt-in manual.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
cd "$root"
token="$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')"
mkdir -p config
cat > config/pairing.json <<EOF
{
  "token": "$token",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "bindHost": "127.0.0.1",
  "note": "LAN binding is opt-in: set DNA_COMPUTE_BIND_HOST explicitly AND add the firewall rule manually; this package never opens a public port automatically."
}
EOF
echo "PAIRING OK (stored at config/pairing.json — not in git)"
echo
echo "Owner-side (macOS Business server) env:"
echo "  DNA_COMPUTE_TOKEN=$token"
echo "  DNA_COMPUTE_DAEMON_URL=http://127.0.0.1:<port>   # or http://<linux-ip>:<port> over the private network AFTER manual firewall opt-in"
