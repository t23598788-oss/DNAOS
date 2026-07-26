-- Real payment gate before dispatch (owner, 2026-07-26): "ระบบต้องเห็นสลิป
-- จริงก่อนถึงสั่งรถ...ถ้าระบบบอกให้ไปส่งแล้วไม่มีคนจ่ายเงิน ใครจะรับผิดชอบ"
-- — "ยืนยันสั่งซื้อ" used to just flip business_events.status to
-- "confirmed" with zero payment check. Store the real quoted total at
-- quote time so an incoming payment slip has a real number to match
-- against, and add "awaiting_payment"/"payment_confirmed" as real
-- intermediate states between "customer confirmed the price" and
-- "actually safe to dispatch."
alter table public.business_events
  add column if not exists quoted_amount numeric;
