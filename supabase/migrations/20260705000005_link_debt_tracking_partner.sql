-- แก้ gap: debt_trackings ของ "คุณ เท่ห์ ขอนแก่น" ไม่มี partner_id
-- ทั้งที่เอกสารทุกใบ (INV/BOQ/QUO/DO) ของลูกค้าคนเดียวกันผูกกับ
-- partners.id = 32099ea4-f09e-470b-aeb8-85e66ae4a303 (PT-014 "คุณ เท่ห์") อยู่แล้ว
--
-- ผลกระทบก่อนแก้: buildDebtNoticeDraft() fallback ไปใช้ customer_name (text)
-- แทนที่จะดึงที่อยู่/เลขผู้เสียภาษี/ผู้ติดต่อจาก partners table จริง

UPDATE public.debt_trackings
SET partner_id = '32099ea4-f09e-470b-aeb8-85e66ae4a303'
WHERE id = 'a03a53fe-031d-488a-90b8-8d56bdc84e8b'
  AND partner_id IS NULL;
