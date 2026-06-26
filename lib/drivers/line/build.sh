#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/line-driver"
swiftc -O -o "$OUT" \
  "$DIR/models.swift" "$DIR/json.swift" "$DIR/inspector.swift" \
  "$DIR/resolver.swift" "$DIR/reader.swift" "$DIR/sender.swift" "$DIR/driver.swift" "$DIR/main.swift" \
  -framework Cocoa -framework ApplicationServices 2>&1
[ $? -eq 0 ] && echo "✅ $OUT" || echo "❌ Build failed"
