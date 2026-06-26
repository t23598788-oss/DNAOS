#!/bin/bash
# Build LINE Controller for DNA OS
# Usage: ./build.sh

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/line-ctrl"

swiftc \
  -O \
  -o "$OUT" \
  "$DIR/session.swift" \
  "$DIR/permissions.swift" \
  "$DIR/accessibility.swift" \
  "$DIR/keyboard.swift" \
  "$DIR/mouse.swift" \
  "$DIR/clipboard.swift" \
  "$DIR/window_manager.swift" \
  "$DIR/line_reader.swift" \
  "$DIR/line_sender.swift" \
  "$DIR/event_monitor.swift" \
  "$DIR/inspector.swift" \
  "$DIR/selector.swift" \
  "$DIR/line_controller.swift" \
  "$DIR/main.swift" \
  -framework Cocoa \
  -framework ApplicationServices \
  2>&1

if [ $? -eq 0 ]; then
  echo "✅ Built: $OUT"
  echo ""
  echo "Usage:"
  echo "  ./line-ctrl status"
  echo "  ./line-ctrl launch"
  echo "  ./line-ctrl focus"
  echo "  ./line-ctrl read"
  echo "  ./line-ctrl read.last"
  echo "  ./line-ctrl read.chatlist"
  echo "  ./line-ctrl open_chat --name \"สุดา\""
  echo "  ./line-ctrl send --text \"สวัสดีครับ\""
  echo "  ./line-ctrl snapshot"
  echo "  ./line-ctrl permissions"
else
  echo "❌ Build failed"
fi
