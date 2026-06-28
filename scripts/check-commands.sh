#!/bin/bash
set -e

echo "=== DNA OS Command Registry Check ==="

REGISTRY="lib/registry/command-registry.json"

if [ ! -f "$REGISTRY" ]; then
  echo "ERROR: $REGISTRY not found"
  exit 1
fi

VIOLATIONS=0

# Check for duplicate-style command names (e.g., invoice.list.v2, invoice_list)
echo "Checking for variant command names..."

# Extract all command names from registry
COMMANDS=$(grep '"[a-z]' "$REGISTRY" | grep -o '"[a-z][a-z0-9_.]*"' | tr -d '"' | sort)

for cmd in $COMMANDS; do
  # Check for .v2, .v3 variants
  if echo "$cmd" | grep -qE '\.(v[0-9]+|new|old|backup|test)$'; then
    echo "VARIANT: $cmd — ห้ามมีชื่อเวอร์ชัน ใช้ชื่อเดียวทั่วระบบ"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi

  # Check for underscore variants (should be dot-separated)
  base=$(echo "$cmd" | sed 's/\./_/g')
  for other in $COMMANDS; do
    other_base=$(echo "$other" | sed 's/\./_/g')
    if [ "$cmd" != "$other" ] && [ "$base" = "$other_base" ]; then
      echo "CONFLICT: $cmd vs $other — ชื่อเดียวกันแต่ format ต่าง"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done
done

# Check that every command in source code is registered
echo "Checking for unregistered commands in source..."

# Find command strings in handler files
grep -rn 'case "[a-z]' lib/v1-input/*.ts 2>/dev/null | grep -o '"[a-z][a-z0-9.]*"' | tr -d '"' | sort -u | while read cmd; do
  if ! grep -q "\"$cmd\"" "$REGISTRY" 2>/dev/null; then
    echo "UNREGISTERED COMMAND: $cmd — ต้อง register ใน $REGISTRY"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done

if [ $VIOLATIONS -gt 0 ]; then
  echo ""
  echo "ERROR: $VIOLATIONS command violations found"
  exit 1
fi

echo "All commands registered and valid"
