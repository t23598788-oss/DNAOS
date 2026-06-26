#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/line-ctrl"

swiftc -O -o "$OUT" \
  "$DIR/ax.swift" \
  "$DIR/resolver.swift" \
  "$DIR/driver.swift" \
  "$DIR/main.swift" \
  -framework Cocoa \
  -framework ApplicationServices \
  2>&1

if [ $? -eq 0 ]; then
  echo "✅ Built: $OUT"
  echo "Commands: connect status focus listChats openChat currentChat readMessages readUnread send reply search back close"
else
  echo "❌ Build failed"
fi
