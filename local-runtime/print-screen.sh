#!/bin/bash
# Prints whatever is currently on screen to the real Brother DCP-T430W
# (WiFi/AirPrint, configured in CUPS). Usage: print-screen.sh <copies>
set -e
COPIES="${1:-1}"
PRINTER="Brother_DCP_T430W"
OUT="/tmp/dnaos-print-$(date +%s).png"

screencapture -x "$OUT"
lp -d "$PRINTER" -n "$COPIES" -o fit-to-page "$OUT"
echo "ส่งพิมพ์แล้ว: $COPIES แผ่น ไปที่ $PRINTER (จากภาพหน้าจอ $OUT)"
