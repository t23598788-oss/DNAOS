#!/bin/bash

# DNA OS Intelligence + Knowledge Coverage
# ตอบคำถาม: ระบบฉลาดแค่ไหน ความรู้องค์กรถูกแปลงเป็นกฎไปกี่ %

bar() {
  local pct=$1
  local width=15
  local filled=$(( pct * width / 100 ))
  local empty=$(( width - filled ))
  local b=""
  for ((i=0; i<filled; i++)); do b="${b}#"; done
  for ((i=0; i<empty; i++)); do b="${b}-"; done
  printf "[%s] %3d%%" "$b" "$pct"
}

# ── Collect Intelligence Metrics ──

# Business Rules (from app_configs count via config-loader + rule-coverage)
RULES_ENFORCED=$(grep -c '"enforced_by"' registry/rule-coverage.json 2>/dev/null || echo "0")
# Evidence-First Automation (registry/EXECUTION_CONTRACT.json, DNA-000041) — computed, not hardcoded; see scripts/check-rule-coverage.sh for why.
RULES_TOTAL=$(node -e "const r=require('./registry/rule-coverage.json'); console.log(Object.keys(r.rules).length + r.uncovered_rules.length)")

# Workflows
WF_COUNT=$(grep -cE '^\s*"[a-z].*"steps"' registry/commands/workflows.json 2>/dev/null || echo "0")

# Commands
CMD_COUNT=$(grep -c '"owner"' registry/command-registry.json 2>/dev/null || echo "0")

# Modules
MOD_COUNT=$(grep -c '"owner"' registry/module-registry.json 2>/dev/null || echo "0")

# Document types
DOC_TYPES=$(grep -o '"document_type"' registry/command-registry.json 2>/dev/null | wc -l | tr -d ' ')
DOC_TYPES=${DOC_TYPES:-6}
# Count from documents engine DOC_LABELS
DOC_ENGINE_TYPES=$(grep -c 'quotation\|invoice\|receipt\|boq\|delivery-order\|purchase-order\|billing' engines/documents/engine.ts 2>/dev/null || echo "7")

# Active domains
ACTIVE_DOMAINS=$(grep -c '"covered"' registry/business-coverage.json 2>/dev/null || echo "0")
PARTIAL_DOMAINS=$(grep -c '"partial"' registry/business-coverage.json 2>/dev/null || echo "0")

# AI involvement — count AI-related modules
AI_MODULES=$(ls services/ai/*.ts 2>/dev/null | wc -l | tr -d ' ')
AI_COMMANDS=$(grep -c '"v4-ai"' registry/command-registry.json 2>/dev/null || echo "0")
AI_COMMANDS=$((AI_COMMANDS + AI_MODULES))

# Human Decisions — commands requiring confirmation
HUMAN_DECISIONS=$(grep -c '"requires_confirmation": true' registry/command-registry.json 2>/dev/null || echo "0")

# Automation Rate
TOTAL_CMD=$CMD_COUNT
if [ "$TOTAL_CMD" -gt 0 ]; then
  AUTO_RATE=$(( (TOTAL_CMD - HUMAN_DECISIONS) * 100 / TOTAL_CMD ))
else
  AUTO_RATE=0
fi

# Config keys in DB (estimated from config-loader usage)
CONFIG_KEYS=$(grep -roh 'getNum(configs\?, "[^"]*"' engines/ 2>/dev/null | grep -o '"[^"]*"' | sort -u | wc -l | tr -d ' ')
CONFIG_KEYS=${CONFIG_KEYS:-0}

# Event types
EVENT_COUNT=$(grep -c '"type"' registry/events.json 2>/dev/null || echo "0")

# ── Knowledge Coverage per Department ──

# Sales: pricing, cost, distance, fuel, capacity, time = 6 engines
SALES_ENGINES=6
SALES_TOTAL=6
SALES_PCT=100

# Purchase: partners, resolver = 2/3
PURCHASE_ENGINES=2
PURCHASE_TOTAL=3
PURCHASE_PCT=$(( PURCHASE_ENGINES * 100 / PURCHASE_TOTAL ))

# Debt: 8 sub-modules (engine, interest, collection, status, transition, scheduler, calculator, overdue)
DEBT_ENGINES=8
DEBT_TOTAL=8
DEBT_PCT=100

# Tax: 1 engine
TAX_PCT=100

# Transport: distance, fuel, capacity, time, cost = 5 engines
TRANSPORT_PCT=100

# Documents: 1 engine, 7 types
DOCUMENT_PCT=100

# Communication: LINE driver, webhooks
COMM_ENGINES=2
COMM_TOTAL=3
COMM_PCT=$(( COMM_ENGINES * 100 / COMM_TOTAL ))

# Inventory: 0
INVENTORY_PCT=0

# HR: 0
HR_PCT=0

# Maintenance: partial (kis-webhook exists, no engine)
MAINT_PCT=20

# Accounting: 0
ACCOUNTING_PCT=0

# Overall knowledge coverage
KNOW_TOTAL=11
KNOW_SUM=$((SALES_PCT + PURCHASE_PCT + DEBT_PCT + TAX_PCT + TRANSPORT_PCT + DOCUMENT_PCT + COMM_PCT + INVENTORY_PCT + HR_PCT + MAINT_PCT + ACCOUNTING_PCT))
KNOW_AVG=$((KNOW_SUM / KNOW_TOTAL))

# ── Print Intelligence Dashboard ──

echo ""
echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║            DNA OS Intelligence Report             ║"
echo "  ╠═══════════════════════════════════════════════════╣"
echo "  ║                                                   ║"
printf "  ║  Business Rules        %-6d                      ║\n" "$RULES_ENFORCED"
printf "  ║  Config Keys (DB)      %-6d                      ║\n" "$CONFIG_KEYS"
printf "  ║  Workflows             %-6d                      ║\n" "$WF_COUNT"
printf "  ║  Commands              %-6d                      ║\n" "$CMD_COUNT"
printf "  ║  Modules               %-6d                      ║\n" "$MOD_COUNT"
printf "  ║  Document Types        %-6d                      ║\n" "$DOC_ENGINE_TYPES"
printf "  ║  Event Types           %-6d                      ║\n" "$EVENT_COUNT"
printf "  ║  Active Domains        %-6d                      ║\n" "$ACTIVE_DOMAINS"
echo "  ║                                                   ║"
echo "  ║  ─── Decision Distribution ───                    ║"
echo "  ║                                                   ║"
printf "  ║  Automated Commands    %-6d                      ║\n" "$((TOTAL_CMD - HUMAN_DECISIONS))"
printf "  ║  Human Decisions       %-6d                      ║\n" "$HUMAN_DECISIONS"
printf "  ║  AI Tool Modules       %-6d                      ║\n" "$AI_COMMANDS"
printf "  ║  Automation Rate       %-5d%%                     ║\n" "$AUTO_RATE"
echo "  ║                                                   ║"
echo "  ╠═══════════════════════════════════════════════════╣"
echo "  ║              Decision Coverage                    ║"
echo "  ╠═══════════════════════════════════════════════════╣"
echo "  ║                                                   ║"

# Parse decision coverage from JSON
DEC_REG="registry/decision-coverage.json"
if [ -f "$DEC_REG" ]; then
  DEC_TOTAL_POINTS=0
  DEC_CODIFIED_POINTS=0

  for key in pricing document_approval vehicle_dispatch supplier_selection debt_collection line_response; do
    LABEL=$(grep -A2 "\"$key\"" "$DEC_REG" | grep '"label"' | sed 's/.*"label": "//;s/".*//' | head -1)
    PCT=$(grep -A4 "\"$key\"" "$DEC_REG" | grep '"coverage_pct"' | grep -o '[0-9]*' | head -1)
    TOTAL_P=$(grep -A3 "\"$key\"" "$DEC_REG" | grep '"total_decision_points"' | grep -o '[0-9]*' | head -1)
    CODED_P=$(grep -A5 "\"$key\"" "$DEC_REG" | grep '"codified":' | grep -o '[0-9]*' | head -1)
    PCT=${PCT:-0}
    TOTAL_P=${TOTAL_P:-0}
    CODED_P=${CODED_P:-0}
    DEC_TOTAL_POINTS=$((DEC_TOTAL_POINTS + TOTAL_P))
    DEC_CODIFIED_POINTS=$((DEC_CODIFIED_POINTS + CODED_P))

    # Pad Thai label to fixed width
    printf "  ║  %-19s %s   ║\n" "$LABEL" "$(bar $PCT)"
  done

  if [ $DEC_TOTAL_POINTS -gt 0 ]; then
    DEC_OVERALL=$((DEC_CODIFIED_POINTS * 100 / DEC_TOTAL_POINTS))
  else
    DEC_OVERALL=0
  fi
  echo "  ║                                                   ║"
  printf "  ║  Overall Decisions     %s   ║\n" "$(bar $DEC_OVERALL)"
fi

echo "  ║                                                   ║"
echo "  ╠═══════════════════════════════════════════════════╣"
echo "  ║          Knowledge Coverage by Department         ║"
echo "  ╠═══════════════════════════════════════════════════╣"
echo "  ║                                                   ║"
printf "  ║  ฝ่ายขาย          %s   ║\n" "$(bar $SALES_PCT)"
printf "  ║  ลูกหนี้/เก็บเงิน  %s   ║\n" "$(bar $DEBT_PCT)"
printf "  ║  ภาษี             %s   ║\n" "$(bar $TAX_PCT)"
printf "  ║  ขนส่ง            %s   ║\n" "$(bar $TRANSPORT_PCT)"
printf "  ║  เอกสาร           %s   ║\n" "$(bar $DOCUMENT_PCT)"
printf "  ║  จัดซื้อ           %s   ║\n" "$(bar $PURCHASE_PCT)"
printf "  ║  สื่อสาร/LINE     %s   ║\n" "$(bar $COMM_PCT)"
printf "  ║  ซ่อมบำรุง         %s   ║\n" "$(bar $MAINT_PCT)"
printf "  ║  คลังสินค้า        %s   ║\n" "$(bar $INVENTORY_PCT)"
printf "  ║  HR/บุคลากร       %s   ║\n" "$(bar $HR_PCT)"
printf "  ║  บัญชี/การเงิน    %s   ║\n" "$(bar $ACCOUNTING_PCT)"
echo "  ║                                                   ║"
printf "  ║  Overall Knowledge     %s   ║\n" "$(bar $KNOW_AVG)"
echo "  ║                                                   ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo ""
echo "  Generated: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# ── Append to DNA_OS_HEALTH.json ──

cat > DNA_OS_INTELLIGENCE.json << EOF
{
  "generated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "intelligence": {
    "business_rules": $RULES_ENFORCED,
    "config_keys": $CONFIG_KEYS,
    "workflows": $WF_COUNT,
    "commands": $CMD_COUNT,
    "modules": $MOD_COUNT,
    "document_types": $DOC_ENGINE_TYPES,
    "event_types": $EVENT_COUNT,
    "active_domains": $ACTIVE_DOMAINS
  },
  "decisions": {
    "automated_commands": $(( TOTAL_CMD - HUMAN_DECISIONS )),
    "human_decisions": $HUMAN_DECISIONS,
    "ai_tool_modules": $AI_COMMANDS,
    "automation_rate_pct": $AUTO_RATE
  },
  "knowledge_coverage": {
    "sales": $SALES_PCT,
    "debt": $DEBT_PCT,
    "tax": $TAX_PCT,
    "transport": $TRANSPORT_PCT,
    "documents": $DOCUMENT_PCT,
    "purchase": $PURCHASE_PCT,
    "communication": $COMM_PCT,
    "maintenance": $MAINT_PCT,
    "inventory": $INVENTORY_PCT,
    "hr": $HR_PCT,
    "accounting": $ACCOUNTING_PCT,
    "overall_pct": $KNOW_AVG
  },
  "decision_coverage": {
    "pricing": 100,
    "document_approval": 100,
    "vehicle_dispatch": 80,
    "supplier_selection": 60,
    "debt_collection": 100,
    "line_response": 75,
    "total_decision_points": ${DEC_TOTAL_POINTS:-0},
    "codified_points": ${DEC_CODIFIED_POINTS:-0},
    "overall_pct": ${DEC_OVERALL:-0}
  }
}
EOF
