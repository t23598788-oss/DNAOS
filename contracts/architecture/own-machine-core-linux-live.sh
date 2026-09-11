#!/usr/bin/env bash
# Step 8 live generic-Linux proof. Ephemeral Node Linux container.
# Does not add Docker/systemd as DNA OS architecture.
# Does not unlock host write-gate files; container sees git-object overlay only.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SECRET="step8-linux-live-owner-command-secret"
PORT="8791"
IMAGE="node:22-bookworm"
EVIDENCE_DIR="$ROOT/tests/__sandbox__/step8-linux-live"
OVERLAY="$EVIDENCE_DIR/write-gate-git-overlay"
mkdir -p "$EVIDENCE_DIR" "$OVERLAY"

SHA="$(git rev-parse HEAD)"
echo "$SHA" > "$EVIDENCE_DIR/commit-sha.txt"

# Reconstruct write-gate from git + unlocked working-tree files. Host schg files stay untouched.
git ls-files -z -- "permissions/write-gate" | while IFS= read -r -d '' rel; do
  dest="$OVERLAY/${rel#permissions/write-gate/}"
  mkdir -p "$(dirname "$dest")"
  if git show "HEAD:$rel" > "$dest" 2>/dev/null; then
    :
  else
    # Untracked/unlocked working-tree file (e.g. rules.ts after Owner unlock).
    cp "$ROOT/$rel" "$dest"
  fi
done
# Working-tree unlocked files that may be newer than HEAD.
if [[ -f "$ROOT/permissions/write-gate/rules.ts" ]]; then
  cp "$ROOT/permissions/write-gate/rules.ts" "$OVERLAY/rules.ts"
fi
if [[ -f "$ROOT/permissions/write-gate/tests/policy.test.ts" ]]; then
  mkdir -p "$OVERLAY/tests"
  cp "$ROOT/permissions/write-gate/tests/policy.test.ts" "$OVERLAY/tests/policy.test.ts"
fi

cat > "$EVIDENCE_DIR/in-container-probe.sh" <<'PROBE'
#!/usr/bin/env bash
set -euo pipefail
cd /work
export OWNER_COMMAND_HTTP_SHARED_SECRET="${OWNER_COMMAND_HTTP_SHARED_SECRET:?}"
export HOST=127.0.0.1
export PORT="${PORT:-8791}"
unset RAILWAY_PROJECT_TOKEN RAILWAY_ENVIRONMENT_ID RAILWAY_SERVICE_ID RAILWAY_DEPLOYMENT_ID VERCEL_TOKEN || true

uname -a > /evidence/uname.txt
cat /etc/os-release > /evidence/os-release.txt
node -v > /evidence/node-version.txt
dpkg --print-architecture > /evidence/dpkg-arch.txt 2>/dev/null || true
printf '%s\n' "$DNA_OS_PROOF_SHA" > /evidence/commit-sha.txt
env | awk -F= '{print $1}' | sort > /evidence/env-names-present.txt

echo "npm ci"
npm ci --no-audit --no-fund

echo "conversation-runtime:build"
npm run conversation-runtime:build

LAUNCH='npx tsx transport/owner-command-http/server.ts'
printf '%s\n' "$LAUNCH" > /evidence/launch-command.txt
printf 'OWNER_COMMAND_HTTP_SHARED_SECRET HOST PORT\n' > /evidence/env-supplied.txt
printf 'RAILWAY_PROJECT_TOKEN RAILWAY_ENVIRONMENT_ID RAILWAY_SERVICE_ID RAILWAY_DEPLOYMENT_ID VERCEL_TOKEN\n' > /evidence/env-absent.txt

echo "boot Core"
set +e
npx tsx transport/owner-command-http/server.ts > /evidence/server-stdout.log 2> /evidence/server-stderr.log &
SERVER_PID=$!
set -e
echo "$SERVER_PID" > /evidence/server-pid.txt

ok=0
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" > /evidence/health.json 2>/dev/null; then
    ok=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "server exited before health" >> /evidence/server-stderr.log
    break
  fi
  sleep 1
done
if [[ "$ok" != 1 ]]; then
  echo BOOT_FAIL > /evidence/boot-result.txt
  cat /evidence/server-stderr.log || true
  exit 1
fi
echo BOOT_OK > /evidence/boot-result.txt
ps -o pid,ppid,cmd -p "$SERVER_PID" > /evidence/ps-server.txt || true

curl -sS -o /evidence/inventory.json -w '%{http_code}' "http://127.0.0.1:${PORT}/runtime/inventory" > /evidence/inventory.status
curl -sS -o /evidence/handoffs.json -w '%{http_code}' "http://127.0.0.1:${PORT}/handoffs" > /evidence/handoffs.status
curl -sS -o /evidence/console.json -w '%{http_code}' "http://127.0.0.1:${PORT}/owner/console" > /evidence/console.status

curl -sS -o /evidence/unauth.json -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/command" \
  -H 'content-type: application/json' \
  -d '{"commandText":"digitalocean","ownerIdentity":{"id":"step8-linux","email":"step8-linux@example.invalid"}}' \
  > /evidence/unauth.status

curl -sS -o /evidence/command.json -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/command" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${OWNER_COMMAND_HTTP_SHARED_SECRET}" \
  -d '{"commandText":"digitalocean","ownerIdentity":{"id":"step8-linux","email":"step8-linux@example.invalid"}}' \
  > /evidence/command.status

curl -sS -o /evidence/permission.json -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/command" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${OWNER_COMMAND_HTTP_SHARED_SECRET}" \
  -d '{"commandText":"ตรวจ permission","ownerIdentity":{"id":"step8-linux","email":"step8-linux@example.invalid"}}' \
  > /evidence/permission.status

node -e 'const fs=require("fs"); const cmd=JSON.parse(fs.readFileSync("/evidence/command.json","utf8")); const mcp=cmd.mcp||{}; const task=mcp.dna_os_task_id||(mcp.result&&mcp.result.task_id)||""; fs.writeFileSync("/evidence/task-id.txt", String(task));'
TASK_ID="$(cat /evidence/task-id.txt)"
if [[ -n "$TASK_ID" ]]; then
  curl -sS -o /evidence/task.json -w '%{http_code}' "http://127.0.0.1:${PORT}/task/${TASK_ID}" > /evidence/task.status
fi

curl -sS -o /evidence/mac-auth.json -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/computer-use/owner/authenticate" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${OWNER_COMMAND_HTTP_SHARED_SECRET}" \
  -d '{"method":"touch-id","expected_owner":"step8","ttl_seconds":60}' \
  > /evidence/mac-auth.status

curl -sS -o /evidence/local-op.json -w '%{http_code}' -X POST "http://127.0.0.1:${PORT}/local/operation" \
  -H 'content-type: application/json' \
  -H "Authorization: Bearer ${OWNER_COMMAND_HTTP_SHARED_SECRET}" \
  -d '{"op":"probe"}' \
  > /evidence/local-op.status

CHILDREN_BEFORE="$(pgrep -P "$SERVER_PID" | tr '\n' ' ' || true)"
printf '%s\n' "$CHILDREN_BEFORE" > /evidence/children-before-term.txt

kill -TERM "$SERVER_PID"
waited=0
term_ok=0
for i in $(seq 1 20); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    term_ok=1
    break
  fi
  sleep 1
  waited=$((waited+1))
done
if [[ "$term_ok" != 1 ]]; then
  echo SIGTERM_TIMEOUT > /evidence/shutdown.txt
  kill -KILL "$SERVER_PID" 2>/dev/null || true
  echo SHUTDOWN_KILLED >> /evidence/shutdown.txt
else
  wait "$SERVER_PID" || true
  echo SIGTERM_OK waited_s=$waited > /evidence/shutdown.txt
fi
ss -ltn 2>/dev/null | grep ":${PORT}" > /evidence/port-after.txt || true
pgrep -P "$SERVER_PID" > /evidence/children-after.txt 2>/dev/null || true
printf 'exit_waited_s=%s\n' "$waited" >> /evidence/shutdown.txt

run_esbuild_test() {
  local suite="$1"
  local entry="$2"
  local out="/tmp/${suite}.cjs"
  local status=0
  set +e
  ./node_modules/.bin/esbuild "$entry" --bundle --platform=node --format=cjs --outfile="$out" --log-level=error
  status=$?
  if [[ $status -ne 0 ]]; then
    echo BUILD_FAIL > "/evidence/${suite}.exit"
    echo "BUILD_FAIL $suite" | tee "/evidence/${suite}.log"
    set -e
    return "$status"
  fi
  # Preserve node exit (not tee): pipefail + PIPESTATUS[0]
  set -o pipefail
  node "$out" | tee "/evidence/${suite}.log"
  status=${PIPESTATUS[0]:-$?}
  set +o pipefail
  echo "$status" > "/evidence/${suite}.exit"
  rm -f "$out"
  set -e
  return "$status"
}
SUITE_FAIL=0
run_esbuild_test runtime-endpoint-registry control/runtime-endpoint-registry/tests/runtime-endpoint-registry.test.ts || SUITE_FAIL=1
run_esbuild_test caller-migration control/runtime-endpoint-registry/tests/caller-migration.test.ts || SUITE_FAIL=1
run_esbuild_test portability-domain-guard control/runtime-endpoint-registry/tests/portability-domain-guard.test.ts || SUITE_FAIL=1
run_esbuild_test runtime-node contracts/architecture/runtime-node-and-optional-provider.test.ts || SUITE_FAIL=1
run_esbuild_test portable-supervisor control/runtime-control/tests/portable-supervisor.test.ts || SUITE_FAIL=1
run_esbuild_test secret-resolver credentials/secret-resolver/tests/core-node-secret-resolver.test.ts || SUITE_FAIL=1
run_esbuild_test checkout-portability software/repository-registry/tests/checkout-portability.test.ts || SUITE_FAIL=1
run_esbuild_test network-auth-gate permissions/network-auth-gate/tests/policy.test.ts || SUITE_FAIL=1
run_esbuild_test own-machine-core-acceptance contracts/architecture/own-machine-core-acceptance.test.ts || SUITE_FAIL=1
if [[ "$SUITE_FAIL" != 0 ]]; then
  echo SUITE_FAIL > /evidence/suite-aggregate.txt
  exit 1
fi
echo SUITE_OK > /evidence/suite-aggregate.txt
PROBE
chmod +x "$EVIDENCE_DIR/in-container-probe.sh"

echo "docker pull $IMAGE"
docker pull "$IMAGE"

# Named volume hides Darwin node_modules; write-gate overlay hides host schg files inside the container only.
docker run --rm \
  --name dnaos-step8-linux-live \
  -e OWNER_COMMAND_HTTP_SHARED_SECRET="$SECRET" \
  -e PORT="$PORT" \
  -e DNA_OS_PROOF_SHA="$SHA" \
  -v "$ROOT:/work" \
  -v "dnaos-step8-linux-node-modules:/work/node_modules" \
  -v "$OVERLAY:/work/permissions/write-gate:ro" \
  -v "$EVIDENCE_DIR:/evidence" \
  -w /work \
  "$IMAGE" \
  bash /evidence/in-container-probe.sh
PROOF_RC=$?
if [[ "$PROOF_RC" -ne 0 ]]; then
  echo "Linux live proof FAILED (container exit $PROOF_RC). Evidence: $EVIDENCE_DIR" >&2
  exit "$PROOF_RC"
fi
echo "Linux live proof finished. Evidence: $EVIDENCE_DIR"
