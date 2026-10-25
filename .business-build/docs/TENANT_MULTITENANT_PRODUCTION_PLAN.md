# MULTI-TENANT — PRODUCTION MIGRATION & ROLLBACK PLAN

**สถานะ: ยังไม่ apply production · ยังไม่ push/deploy — รอคำสั่ง Owner (ตามภารกิจ REMAINING GAPS EXECUTION)**
เอกสารนี้คือแผนที่ผ่านการทดสอบจริงบนฐานข้อมูลชั่วคราวในเครื่องแล้ว (ไม่ใช่ข้อเสนอเชิงทฤษฎี)
หลักฐานการทดสอบ: `npm run tenant-migration:test` · `npm run tenant-matrix:test` · `npm run tenant-e2e:test`

---

## 1. ขอบเขตที่เปลี่ยน (additive เท่านั้น)

| Migration | สิ่งที่สร้าง | ผลกับข้อมูลเดิม |
|---|---|---|
| `20261018000001_tenant_core_v1.sql` | `organizations`, `org_members` (tenant root) + policy ของ 2 ตารางนี้ + `companies.organization_id` (nullable) | ไม่แตะแถวเดิม · คอลัมน์ใหม่ nullable |
| `20261018000002_tenant_org_scope_v2.sql` | helper `tenant_has_membership(uuid)`, `tenant_org_of_line_user(text)` + SELECT policy แบบ member-scoped บนตารางธุรกิจ 13 ตาราง + index ที่ policy join ใช้ | SELECT ของ service-role/admin เดิมไม่เปลี่ยน · แถวที่ยังไม่ map องค์กร = ไม่ถูกเปิดให้ session ใด (fail-closed) |
| `20261018000003_tenant_org_binding_v3.sql` | `organization_id` (nullable) + index + SELECT policy บน 6 ตารางที่เหลือ GAP_ORG_MAPPING: `bank_statement_transactions`, `bank_notifications`, `storage_evidence`, `file_snapshots`, `transactions`, `resource_transactions` | ไม่ backfill production (ไม่เดาเจ้าของ) · แถว NULL = fail-closed |

**ไม่มีการสร้างตารางธุรกิจคู่ขนาน · ไม่มี writer ใหม่ · ไม่กำหนด DNA OS เป็น tenant เริ่มต้น**

## 2. ลำดับการ apply (ห้ามสลับ)

```
1) snapshot สำรองข้อมูล:  npm run backup
2) ตรวจของเดิม:           npm run deploy-gate        (ต้อง READY)
3) apply ตามลำดับเวลาเท่านั้น:
     20261018000001_tenant_core_v1.sql
     20261018000002_tenant_org_scope_v2.sql
     20261018000003_tenant_org_binding_v3.sql
4) ตรวจหลัง apply (read-only):
     npm run tenant-core:test        (registry/authority contract)
     npm run tenant-matrix:test      (RLS + membership + concurrency บน Postgres จริง)
     npm run canonical:test          (ของเดิมต้องไม่เสียหาย)
```

เหตุผลของลำดับ: V2 ต้องมี `organizations`/`org_members` จาก V1 และใช้ `companies.organization_id` จาก V1 ·
V3 ต้องมี helper `tenant_has_membership` จาก V2 — ตรวจแล้วว่า apply ด้วย `ON_ERROR_STOP` ผ่านทุกไฟล์ในลำดับนี้

## 3. ความเข้ากันได้ (พิสูจน์แล้ว)

- **Database compatibility** — `npm run tenant-migration:test` ตรวจว่าทุกตารางที่ V3 แตะได้ `organization_id` เพิ่ม 1 คอลัมน์ และไม่มีคอลัมน์เดิมหาย (additive จริง)
- **API compatibility** — policy เปิดเฉพาะ `SELECT` ให้ `authenticated`; write ยังผ่าน service-key + canonical writer hook เดิม (`assertWriteScope`) → route เดิมไม่ต้องแก้สัญญา
- **Data compatibility** — แถว production ที่ยังไม่ map องค์กร (`organization_id is null`) ไม่ถูกเปิดให้ session ใด (fail-closed) = พฤติกรรมเดิมของ service-role/admin คงอยู่

## 4. Rollback plan (ทดสอบแล้ว)

ไฟล์ถอยอยู่ใน `supabase/rollback/` ตามแบบเดิมของ repo และ **ถอยตามลำดับย้อนกลับ**:

```
1) 20261018000003_tenant_org_binding_v3_rollback.sql
2) 20261018000002_tenant_org_scope_v2_rollback.sql
3) 20261018000001_tenant_core_v1_rollback.sql
```

- ถอย **policy / index / helper function** ครบถ้วน (ตรวจแล้ว: policy `tenant*` = 0, function = 0)
- **ไม่ DROP คอลัมน์ `organization_id` อัตโนมัติ** — เพราะ ingestion อาจ stamp ค่าไปแล้ว การลบ = ทำลาย mapping จริง · คำสั่ง `alter table … drop column` ถูก comment ไว้ให้ใช้เฉพาะเมื่อสำรองข้อมูลและยืนยันแล้ว
- **ไม่ลบข้อมูลแถวใด** (ตรวจแล้ว: `companies` + `organizations` เท่าเดิมหลังถอย)
- ถอยแล้วระบบกลับสู่สถานะ "service-role/admin เห็นข้อมูลเดิม" — ไม่มีโค้ดฝั่งแอปผูกกับ policy เหล่านี้ (แอปอ่านผ่าน service-key)

### เงื่อนไขที่ต้องถอย (triggers)
- canonical/document/accounting test บน production ตรวจพบความผิดปกติที่โยงกับ tenant policy
- พบ cross-tenant read/write จาก session จริง (นี่คือความล้มเหลวร้ายแรงที่สุด → ถอยทันที)
- performance regression ที่ยืนยันได้ว่ามาจาก policy join

### สิ่งที่ต้องทำก่อน/หลังถอย
1. `npm run backup` ก่อนถอยทุกครั้ง
2. ถอย SQL ตามลำดับข้างบน
3. รัน `npm run tenant-core:test` + `npm run canonical:test` ยืนยันว่ากลับสู่สภาพเดิม
4. ปรับ `registry/TENANT_DATA_COVERAGE.json` กลับเป็น `GAP_ORG_MAPPING` สำหรับ 3 กลุ่มที่ V3 เคยปิด (ระบุไว้ในไฟล์ rollback ของ V3)
5. บันทึกการถอยใน `registry/CHANGELOG.json`

## 5. การตรวจสอบ Tenant Isolation หลัง apply (ต้องผ่านก่อนเปิดใช้จริง)

- `npm run tenant-matrix:test` — A อ่าน A ได้ · B อ่าน B ได้ · A อ่าน B ไม่ได้ · cross-tenant write ถูกปฏิเสธ · service_role ผ่าน authority ที่กำหนด · concurrent requests ไม่ปะปน
- `npm run tenant-api:test` — HTTP จริง: 401/403 · cross-tenant DENY · missing/invalid org DENY
- `npm run tenant-e2e:test` — manual tool + AI command (synthetic) + reset chat proof
- `npm run tenant-workspace-ui:test` — browser จริง: เลือก/สลับองค์กร · ล้างบริบทแชต · placeholder `ถาม <ชื่อองค์กร>...`

## 6. ข้อจำกัดที่ยังเหลือ (รายงานตรง ไม่ปิดบัง)

1. **HTTP-level PostgREST integration** ต้องมี Docker + Supabase local stack — เครื่องนี้ไม่มี · ใช้ Postgres + JWT claims (`SET ROLE authenticated` + `request.jwt.claim.*`) แทน ซึ่งรัน RLS จริงเหมือน PostgREST
2. **Migration นี้ยังไม่ถูก apply บน production** และไม่มีข้อมูล production ถูก backfill (โดยเจตนา — ต้องให้ admin องค์กรเป็นผู้ map)
3. **admin routes ยังไม่แนบ TenantScope ทุกตัว** — policy กลางบังคับที่ชั้น middleware สำหรับ API ธุรกิจแล้ว (นับรวมจริงตาม inventory) แต่ route ที่ไม่อยู่ใน prefix ธุรกิจยังใช้ guard เดิม
4. **bank / evidence / transactions** มีคอลัมน์ + policy แล้ว แต่ ingestion ยังต้อง stamp `organization_id` ตอนเขียนจริง (ยังไม่มี writer ที่ stamp ให้ — ต้องทำในรอบถัดไป)
5. **`npm run mcp-worker:test` รันไม่ได้ใน checkout นี้** — ต้องมี `registry/worker-tool-registry.json` ซึ่งไม่มีอยู่ใน repository (ตรวจ git history แล้วไม่เคยมี) = ช่องว่างที่มีอยู่ก่อนงานนี้
