#!/bin/bash
# DNA OS Agent — เริ่มต้น
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"

echo "DNA OS Agent"
echo "Building LINE Driver..."
cd "$ROOT/plugins/line" && bash build.sh

echo ""
echo "Starting Agent..."
cd "$ROOT" && npx tsx "$DIR/server.ts"
