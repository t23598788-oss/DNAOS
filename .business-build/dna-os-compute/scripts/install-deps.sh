#!/usr/bin/env bash
# DNA OS AI Server — dependency bootstrap (Linux, Phase 3).
# Installs ONLY into this runtime dir; never system-wide; never touches
# Production credentials; never opens a port.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
cd "$root"

echo "== DNA OS AI Server dependency bootstrap (Linux) =="
node_major="$(node -v | sed 's/^v//' | cut -d. -f1)"
[ "$node_major" -ge 20 ] || { echo "Node.js >= 20 required" >&2; exit 1; }

if [ ! -x node_modules/.bin/tsc ]; then
  echo "installing typescript/tsx/types (local .) ..."
  npm install --no-audit --no-fund typescript@^5.7 tsx@^4.19 "@types/node@^22"
fi

echo "building dist/ ..."
./node_modules/.bin/tsc -p .
[ -f dist/daemon.js ] || { echo "dist/daemon.js missing after build" >&2; exit 1; }

echo "probing GPU (rocm-smi optional) ..."
if command -v rocm-smi >/dev/null 2>&1; then
  rocm-smi --showproductname --showdriverversion || true
else
  echo "rocm-smi not found — GPU stays fail-closed UNAVAILABLE (install ROCm userland to enable AMD detection)"
fi

if command -v ollama >/dev/null 2>&1; then
  echo "ollama: $(ollama --version)"
else
  echo "ollama NOT installed (optional). To enable ai.infer: install Ollama, set DNA_COMPUTE_INFER_ENDPOINT=http://127.0.0.1:11434"
fi

echo "INSTALL-DEPS OK — port remains CLOSED until scripts/start.sh is run with a token."
