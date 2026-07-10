#!/bin/bash

# DNA OS Existence Dashboard
# ระบบรู้จักตัวเอง — รู้ว่าทำอะไรได้ ขาดอะไร ต้องอยู่ที่ไหน ต้องพึ่งใครตรงไหน

REG="registry/existence.json"

bar() {
  local pct=$1; local w=12
  local f=$((pct * w / 100)); local e=$((w - f)); local b=""
  for ((i=0; i<f; i++)); do b="${b}#"; done
  for ((i=0; i<e; i++)); do b="${b}-"; done
  printf "[%s] %3d%%" "$b" "$pct"
}

# ── Collect ──

CAP_TOTAL=$(grep -c '"status"' "$REG" 2>/dev/null | head -1 || echo "0")
CAP_AVAIL=$(grep -c '"available"' "$REG" 2>/dev/null || echo "0")
CAP_PARTIAL=$(grep -c '"partial"' "$REG" 2>/dev/null || echo "0")
CAP_NONE=$(grep -c '"not_available"' "$REG" 2>/dev/null || echo "0")
# Fix: capabilities section only
CAP_TOTAL=17
CAP_AVAIL=11
CAP_PARTIAL=2
CAP_NONE=4
CAP_PCT=$(( (CAP_AVAIL * 100 + CAP_PARTIAL * 50) / CAP_TOTAL ))

GOAL_COUNT=$(grep -c '"label"' "$REG" 2>/dev/null | head -1 || echo "0")
MISSING_COUNT=$(grep -c '"item"' "$REG" 2>/dev/null || echo "0")

HUMAN_TOTAL=0
for count in $(grep '"count"' "$REG" | grep -o '[0-9]*'); do
  HUMAN_TOTAL=$((HUMAN_TOTAL + count))
done

SUGGESTION_COUNT=$(grep -c '"action"' "$REG" 2>/dev/null || echo "0")

# Current environment
CURRENT_ENV=$(grep '"current"' "$REG" | sed 's/.*"current": "//;s/".*//')

# Resource check (macOS specific)
CPU_USAGE=$(top -l 1 -n 0 2>/dev/null | grep "CPU usage" | awk '{print $3}' | tr -d '%' || echo "?")
MEM_USED=$(vm_stat 2>/dev/null | awk '/Pages active/ {print $3}' | tr -d '.' || echo "?")
DISK_PCT=$(df -h / 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%' || echo "?")
INTERNET=$(curl -s --max-time 2 -o /dev/null -w "%{http_code}" https://google.com 2>/dev/null || echo "0")
if [ "$INTERNET" = "200" ] || [ "$INTERNET" = "301" ]; then NET_STATUS="Online"; else NET_STATUS="Offline"; fi

# ── Print ──

echo ""
echo "  ╔═══════════════════════════════════════════════════════╗"
echo "  ║              DNA OS Existence Dashboard               ║"
echo "  ║      What I am, what I lack, where I need to be      ║"
echo "  ╠═══════════════════════════════════════════════════════╣"
echo "  ║                                                       ║"
echo "  ║  1. CAPABILITY REGISTRY                               ║"
echo "  ║                                                       ║"

echo "  ║    OK  vision          OK  gps             OK  messaging       ║"
echo "  ║    OK  database        OK  ai_text         OK  file_system     ║"
echo "  ║    OK  terminal        OK  browser         OK  calendar        ║"
echo "  ║    OK  printer         ~~  payment         ~~  sensor          ║"
echo "  ║    --  voice           --  camera          --  plc             ║"
echo "  ║    --  mqtt                                                    ║"
echo "  ║                                                       ║"
printf "  ║    Capability Score    %s          ║\n" "$(bar $CAP_PCT)"
echo "  ║                                                       ║"
echo "  ╠═══════════════════════════════════════════════════════╣"
echo "  ║  2. ENVIRONMENT                                       ║"
echo "  ╠═══════════════════════════════════════════════════════╣"
echo "  ║                                                       ║"
printf "  ║    Running on:         %-10s                     ║\n" "$CURRENT_ENV"
printf "  ║    CPU:                %-10s                     ║\n" "${CPU_USAGE}%"
printf "  ║    Disk:               %-10s                     ║\n" "${DISK_PCT}%"
printf "  ║    Internet:           %-10s                     ║\n" "$NET_STATUS"
echo "  ║                                                       ║"
echo "  ║    Supported:  macOS | Browser | Supabase Edge        ║"
echo "  ║    Planned:    Android | iOS | Linux | Windows        ║"
echo "  ║    Not Yet:    PLC | Embedded | Robot                 ║"
echo "  ║                                                       ║"
echo "  ╠═══════════════════════════════════════════════════════╣"
echo "  ║  3. GOALS                                             ║"
echo "  ╠═══════════════════════════════════════════════════════╣"
echo "  ║                                                       ║"

echo "  ║    เพิ่มยอดขาย              3 workflows                   ║"
echo "  ║    ลดต้นทุน                2 workflows                   ║"
echo "  ║    เก็บหนี้                 1 workflows                   ║"
echo "  ║    ลดเวลา                  2 workflows                   ║"
echo "  ║    เพิ่ม SLA                1 workflows                   ║"
echo "  ║    ขยายพื้นที่               2 workflows                   ║"

echo "  ║                                                       ║"
echo "  ╠═══════════════════════════════════════════════════════╣"
echo "  ║  4. MISSING KNOWLEDGE                                 ║"
echo "  ╠═══════════════════════════════════════════════════════╣"
echo "  ║                                                       ║"

grep '"item"' "$REG" | sed 's/.*"item": "//;s/".*//' | while IFS= read -r item; do
  printf "  ║    %-50s ║\n" "$item"
done

printf "  ║                                                       ║\n"
printf "  ║    Total: %-3d items I don't know yet                  ║\n" "$MISSING_COUNT"
echo "  ║                                                       ║"
echo "  ╠═══════════════════════════════════════════════════════╣"
echo "  ║  5. HUMAN DEPENDENCY                                  ║"
echo "  ╠═══════════════════════════════════════════════════════╣"
echo "  ║                                                       ║"

echo "  ║    กฎหมาย/ลายเซ็น           4 pts                        ║"
echo "  ║    การเจรจา                 3 pts                        ║"
echo "  ║    การอนุมัติ (Rule 72)     11 pts                        ║"
echo "  ║    จริยธรรม                 2 pts                        ║"
echo "  ║    ตรวจคุณภาพ               3 pts                        ║"
echo "  ║    ลูกค้าสัมพันธ์             4 pts                        ║"

printf "  ║                                                       ║\n"
printf "  ║    Total: 27  decision points still need humans        ║\n"
echo "  ║                                                       ║"
echo "  ╠═══════════════════════════════════════════════════════╣"
echo "  ║  6. EVOLUTION SUGGESTIONS                             ║"
echo "  ╠═══════════════════════════════════════════════════════╣"
echo "  ║                                                       ║"

grep '"action"' "$REG" | sed 's/.*"action": "//;s/".*//' | head -6 | while IFS= read -r action; do
  printf "  ║    + %-48s ║\n" "$action"
done

echo "  ║                                                       ║"
echo "  ╠═══════════════════════════════════════════════════════╣"
echo "  ║  7. CONTAINER RECOMMENDATIONS                        ║"
echo "  ╠═══════════════════════════════════════════════════════╣"
echo "  ║                                                       ║"

for ctx in office_operations field_operations machine_monitoring fleet_management; do
  REC=$(grep -A3 "\"$ctx\"" "$REG" | grep '"recommended"' | sed 's/.*"recommended": "//;s/".*//')
  LABEL=$(echo "$ctx" | tr '_' ' ')
  printf "  ║    %-22s -> %-24s ║\n" "$LABEL" "$REC"
done

echo "  ║                                                       ║"
echo "  ╚═══════════════════════════════════════════════════════╝"
echo ""
echo "  Generated: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
