#!/bin/bash
set -e

echo "=== DNA OS Module Registry Check ==="

REGISTRY="lib/registry/module-registry.json"

if [ ! -f "$REGISTRY" ]; then
  echo "ERROR: $REGISTRY not found"
  exit 1
fi

VIOLATIONS=0

# Find all source files that should be registered
while IFS= read -r file; do
  # Normalize path (remove leading ./)
  file="${file#./}"

  # Check if file exists in registry
  if ! grep -q "\"$file\"" "$REGISTRY" 2>/dev/null; then
    echo "UNREGISTERED: $file — ต้อง register ใน $REGISTRY ก่อน commit"
    VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(find app components lib -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/.next/*" \
  -not -path "lib/drivers/line/*" \
  2>/dev/null | sort)

if [ $VIOLATIONS -gt 0 ]; then
  echo ""
  echo "ERROR: $VIOLATIONS ไฟล์ไม่ได้ register — Shadow System detected (Rule: No Shadow System)"
  echo "วิธีแก้: เพิ่มไฟล์ใน $REGISTRY พร้อม owner, layer, purpose"
  exit 1
fi

echo "All source files registered"
