# governance/permission-rules/

กฎสิทธิ์ระดับระบบ — split มาจาก `governance/RULES.md` เดิม

## G-PERM-001 — `supabaseAdmin()`/service-role ไม่ใช่ authorization model ของระบบนี้

`dna-os-deadboard`'s `supabaseAdmin()` (service role, bypass RLS) ห้ามถูก
นำมาใช้ซ้ำเป็น "วิธีตัดสินสิทธิ์" ของระบบนี้ — authorization model ของ
repo นี้คือ `permissions/access-control/` เท่านั้น: ตรวจ scope ต่อ Account
ปฏิเสธข้าม account เป็นค่าเริ่มต้นเสมอ, break-glass เป็นทางเดียวที่ยกเว้น
ได้และไม่ใช่สิทธิ์ถาวร

## G-PERM-002 — Platform Owner ≠ Data Owner

ดู `permissions/access-control/platform-capability.ts` และ
`permissions/access-control/break-glass.ts` — อำนาจระดับ platform ของ
Owner ไม่เคยแปลว่ามีสิทธิ์อ่านข้อมูลของ tenant โดยอัตโนมัติ

## G-PERM-003 — Owner controls platform / Tenant controls tenant data / Service accesses only required scope / Cross-tenant access = denied by default

หลักยึดระยะยาวของ permission model ทั้งระบบ (Owner, 2026-08-14)
