#!/bin/bash
# ask.sh — ถาม thawatchai พร้อมข้อมูลจริงสดจาก Supabase (ไม่ใช่แค่ system prompt ตายตัว)
# ใช้: ~/dna-os-ollama/ask.sh "คำถาม"

QUESTION="$1"
if [ -z "$QUESTION" ]; then
  echo "ใช้: ask.sh \"คำถาม\""
  exit 1
fi

cd "/Users/tam/Desktop/DNA OS-โฟลเดอร์หลักต้นฉบับ /dna-os-deadboard" || exit 1

cat > /tmp/thawatchai_context.sql << 'EOF'
select title, data from app_configs where title in ('fuel-price','vat-rate','company-name')
union all
select 'active_customers', count(*)::text from companies where type='CUSTOMER' and status='ACTIVE'
union all
select 'active_pits', count(*)::text from pit_profiles where deleted_at is null
union all
select 'total_outstanding_debt', coalesce(sum(total_outstanding),0)::text from debt_snapshots
union all
select 'open_quote_requests', count(*)::text from business_events where status in ('new','awaiting_info','quotation_pending');
EOF

LIVE_DATA=$(supabase db query --linked -f /tmp/thawatchai_context.sql 2>/dev/null | grep -v "^Initialising\|new version\|recommend updating")

FULL_PROMPT="ข้อมูลจริงสดจากระบบตอนนี้ (Supabase):
${LIVE_DATA}

คำถามจากเฮีย: ${QUESTION}

ตอบโดยอ้างอิงข้อมูลจริงข้างบนถ้าเกี่ยวข้อง ห้ามเดาตัวเลขที่ไม่มีในข้อมูลข้างบน"

ollama run thawatchai "$FULL_PROMPT"
