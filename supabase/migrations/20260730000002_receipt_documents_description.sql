-- Owner-reported bug (2026-07-30): "มันไปมันว่าอะไรที่เค้าส่งมาเป็นรูปภาพอะไร
-- ไม่ใช่ว่าไปเก็บรูปภาพนะ" — a customer photo classified as product_photo/
-- site_photo was only ever stored as an opaque row (document_type + the raw
-- image path), with no record of what the photo actually depicts in plain
-- language. raw_ocr_text doesn't cover this case — it's meant for text
-- legible ON a document (a bill/slip), not a description of a photo subject.
-- This column holds that real description (e.g. "ภาพกองทรายหยาบ"), populated
-- by engines/ocr-classify.ts's classifyReceiptImage() for product_photo/
-- site_photo only — null for every other document type.
alter table public.receipt_documents
  add column if not exists description text;
