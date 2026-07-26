-- Extends print_jobs (owner, 2026-07-25): "ถ้าโอนก็ต้องเห็นสลิปยืนยันมาปั๊บ
-- แล้วค่อยดำเนินงาน...ถ้าลูกค้าบอกว่าเดี๋ยวเงินสด โอเคก็ดำเนินการเลย" — cash
-- jobs skip payment verification and go straight to print (collected on
-- pickup); transfer jobs still wait for a real matched slip exactly as
-- built earlier today.
alter table public.print_jobs
  add column if not exists payment_method text
    check (payment_method in ('cash', 'transfer'));
