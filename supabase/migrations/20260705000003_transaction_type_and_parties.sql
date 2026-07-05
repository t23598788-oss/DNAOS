-- Transaction: เพิ่ม tx_type, supplier, project, paid_amount
--
-- tx_type: sale | purchase | contract | service | rental | transport
-- supplier_id: ซัพพลายเออร์ (อาจต่างจาก partner ซึ่งเป็นลูกค้า)
-- project_name: รหัส/ชื่อ project (free text เช่น KKN-001)
-- paid_amount: ยอดรับเงินจริง (บันทึกตอน pay action)
-- vat_amount: ภาษีมูลค่าเพิ่ม (คำนวณหรือบันทึกจากเอกสาร)

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS tx_type        text         NOT NULL DEFAULT 'sale',
  ADD COLUMN IF NOT EXISTS supplier_id    uuid         REFERENCES public.partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_name  text,
  ADD COLUMN IF NOT EXISTS project_name   text,
  ADD COLUMN IF NOT EXISTS paid_amount    numeric(14,2),
  ADD COLUMN IF NOT EXISTS vat_amount     numeric(14,2);

CREATE INDEX IF NOT EXISTS idx_transactions_tx_type
  ON public.transactions(tx_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_supplier_id
  ON public.transactions(supplier_id)
  WHERE supplier_id IS NOT NULL;
