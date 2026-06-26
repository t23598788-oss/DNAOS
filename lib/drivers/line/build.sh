#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
MACOS="$DIR/../../macos"
OUT="$DIR/line-driver"

swiftc -O -o "$OUT" \
  "$MACOS/protocol.swift" \
  "$MACOS/ax.swift" \
  "$MACOS/resolver.swift" \
  "$MACOS/keyboard.swift" \
  "$MACOS/mouse.swift" \
  "$MACOS/clipboard.swift" \
  "$MACOS/helpers.swift" \
  "$MACOS/registry.swift" \
  "$DIR/driver.swift" \
  "$DIR/main.swift" \
  -framework Cocoa -framework ApplicationServices 2>&1

[ $? -eq 0 ] && echo "✅ $OUT" || echo "❌ Build failed"
