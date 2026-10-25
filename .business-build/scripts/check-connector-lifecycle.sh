#!/bin/bash
# =============================================================================
# DNA OS — Connector Lifecycle Guard
#
# บังคับใช้ registry/connector-lifecycle.json (LOCKED — Permanent Architecture Law)
# รันใน scripts/pre-commit-check.sh — ห้าม commit ถ้าไม่ผ่าน
#
# Guard A: เฉพาะ core/connector-loader.ts และ gateway/connectors.ts เท่านั้นที่
#          แตะตาราง connectors / connector_webhook_events ตรงได้ — ที่อื่นห้าม
#          (ทุกที่อื่นต้องเรียกผ่านฟังก์ชันที่สองไฟล์นี้ export ออกมา)
#
# Guard B: ห้ามมี Core edit เพื่อรองรับ Connector ใหม่ — core/connector-loader.ts
#          ต้องทำงานผ่าน slug/auth_type แบบทั่วไปเท่านั้น ห้าม hardcode ชื่อ
#          Connector เฉพาะเจาะจง และ engines/connectors/tester.ts ต้อง switch
#          บน auth_type ที่ประกาศไว้ 7 ค่าเท่านั้น ห้ามมี case อื่นเพิ่ม
# =============================================================================
set -e

VIOLATIONS=0
ALLOWED_FILES="core/connector-loader.ts gateway/connectors.ts"
KNOWN_AUTH_TYPES="login oauth api_key token uri mcp webhook"

echo "=== Connector Lifecycle Guard ==="

# --- Guard A: table access confined to the two sanctioned files -------------
echo "--- Guard A: connectors table access confined to Core/Gateway ---"

TOUCHING_FILES=$(grep -rlE '\.from\((\x27|")connectors(\x27|")\)|\.from\((\x27|")connector_webhook_events(\x27|")\)' \
  --include="*.ts" --include="*.tsx" . 2>/dev/null \
  | grep -v node_modules | grep -v '\.next' || true)

for f in $TOUCHING_FILES; do
  FOUND=0
  for allowed in $ALLOWED_FILES; do
    if [ "$f" = "$allowed" ] || [ "$f" = "./$allowed" ]; then
      FOUND=1
      break
    fi
  done
  if [ $FOUND -eq 0 ]; then
    echo "  VIOLATION: $f touches connectors table directly — must go through gateway/connectors.ts or core/connector-loader.ts"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

if [ $VIOLATIONS -eq 0 ]; then
  echo "  OK: only core/connector-loader.ts and gateway/connectors.ts touch the table"
fi

# --- Guard B: no per-connector-identity branching in Core --------------------
echo "--- Guard B: no Core edits to support a specific new Connector ---"

# B1: no hardcoded slug comparison against a literal string (only variable comparisons allowed)
if grep -nE '\bslug\s*===?\s*["\x27][a-zA-Z0-9_-]+["\x27]' core/connector-loader.ts 2>/dev/null | grep -q .; then
  echo "  VIOLATION: core/connector-loader.ts compares slug against a hardcoded literal — Core must stay generic"
  grep -nE '\bslug\s*===?\s*["\x27][a-zA-Z0-9_-]+["\x27]' core/connector-loader.ts
  VIOLATIONS=$((VIOLATIONS + 1))
fi

# B2: tester.ts's auth_type switch must only contain the 7 declared contract types
if [ -f engines/connectors/tester.ts ]; then
  CASE_VALUES=$(grep -oE 'case "[a-z_]+":' engines/connectors/tester.ts | sed -E 's/case "([a-z_]+)":/\1/')
  for cv in $CASE_VALUES; do
    FOUND=0
    for known in $KNOWN_AUTH_TYPES; do
      if [ "$cv" = "$known" ]; then FOUND=1; break; fi
    done
    if [ $FOUND -eq 0 ] && [ "$cv" != "default" ]; then
      echo "  VIOLATION: engines/connectors/tester.ts has an undeclared case '$cv' — auth_type contract is locked to: $KNOWN_AUTH_TYPES"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done
fi

if [ $VIOLATIONS -eq 0 ]; then
  echo "  OK: no per-connector-identity branching found"
fi

echo ""
if [ $VIOLATIONS -gt 0 ]; then
  echo "ERROR: $VIOLATIONS Connector Lifecycle violation(s) — see registry/connector-lifecycle.json"
  exit 1
fi

echo "Connector Lifecycle Law: OK"