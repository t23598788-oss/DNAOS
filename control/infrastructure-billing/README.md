# infrastructure-billing — ใครกำลังคิดเงิน คิดจากอะไร เท่าไร

**หน้าที่:** ทำให้ DNA OS รู้ต้นทุน infrastructure ของตัวเองได้ต่อเนื่อง
ไม่ใช่รู้ครั้งเดียวตอนบิลมา

```
COLLECT → NORMALIZE → CALCULATE → COMPARE → ALERT → STORE EVIDENCE
```

**Input:** credential ของ provider ที่ Owner ล็อกอินไว้แล้วในเครื่อง
**Output:** `collectVercel`, `summarize`, `reconcile`, `buildBaseline`,
`detectAnomalies`, `persistBillingRecords`, `lineageFor`
**Dependency ที่อนุญาต:** `../agent-gateway/contract.ts` (evidence store เดิม),
node built-ins

## กฎที่ Owner ล็อกไว้ (2026-08-27)

**capability นี้คือแหล่งความจริงกลางของต้นทุน** หน้าจอทุกหน้า — Workspace,
หน้าต้นทุน, หรืออะไรก็ตามในอนาคต — **ห้ามคำนวณเงินซ้ำ** ให้เรียก
`costOverview()` แล้วแสดงผลอย่างเดียว

```ts
import { costOverview } from "control/infrastructure-billing/contract";
const view = costOverview({ provider: "vercel", account_id, period_start });
// view.current_bill  view.baseline  view.forecast
// view.top_cost_driver  view.anomalies  view.evidence_ref
```

ทุกยอดมาพร้อมทั้งเลขดิบ (`*_minor` สำหรับเรียงลำดับ) และข้อความจัดรูปแล้ว
(สำหรับแสดง) หน้าจอจึงไม่มีเหตุผลต้องแตะเลขคณิตเลย ถ้าวันหนึ่งหน้าจอต้อง
บวกเลขเอง แปลว่า read model ยังทำหน้าที่ไม่ครบ — ให้แก้ที่นี่ ไม่ใช่ไปบวก
ที่หน้าจอ

เหตุผล: เลขสองชุดที่คำนวณคนละที่จะไม่ตรงกันสักวัน แล้วจะไม่มีใครรู้ว่า
ชุดไหนถูก

## สิ่งที่ห้ามแตะ

- **capability นี้อ่านอย่างเดียวโดยการออกแบบ** ไม่มี export ตัวไหนจ่ายเงิน
  เปลี่ยนแพ็กเกจ หรือปิด resource ได้ — คนเรียกใช้ไปถึงการใช้จ่ายไม่ได้
  แม้จะพยายาม
- **ห้ามให้ AI แตะตัวเลข** ทุกยอดคำนวณด้วยเลขคณิตจำนวนเต็ม
- **เงินเป็น integer หน่วยย่อย (เซนต์) เสมอ** ห้ามใช้ float
- **ห้ามดัดยอดให้ตรง invoice** ถ้าไม่ตรงต้องรายงานว่าไม่ตรง
- **ห้ามผูก schema กับ provider เดียว** — `types.ts` ต้องไม่มีชื่อ field
  เฉพาะเจ้าใดเจ้าหนึ่ง

## ยอดที่แยกไม่ได้ ต้องมองเห็น

เมื่อช่องทางของ provider ไม่ให้ usage รายบรรทัด ระบบจะบันทึกส่วนต่างเป็น
record เดียวที่ `derived = true` และ `classification = UNKNOWN` พร้อมเหตุผล
ว่าช่องไหนเข้าไม่ได้ **ไม่เดาว่าเป็น resource ใด**

## ช่องทางของ Vercel (ทดสอบจริง 2026-08-27)

| ช่องทาง | endpoint | ผล |
|---|---|---|
| API | `/v2/teams/{id}` | ใช้ได้ — invoiceItems, plan, status, period, entitlements |
| API | `/v9/projects` | ใช้ได้ — project, crons |
| EMAIL | ใบเสร็จที่จ่ายสำเร็จ | ใช้ได้ — เป็น baseline |
| USAGE | `/v1/usage` | **HTTP 400** เข้าไม่ได้ |
| INVOICE | `/v1/teams/{id}/invoices` | **HTTP 404** เข้าไม่ได้ |

## การเพิ่ม provider ใหม่

เขียน connector ใน `connectors/` ที่คืน `BillingRecord[]` ตาม schema กลาง
ไม่ต้องแก้ engine, anomaly หรือ persistence เลย

## พิสูจน์ยังไง

`npx tsx control/infrastructure-billing/tests/vercel-forensic-proof.test.ts`

ใช้บัญชี Vercel จริงเป็นชุดข้อมูลแรก และบังคับว่ายอดที่คำนวณต้องตรงกับ
invoice จริงพอดี มิฉะนั้นเทสต์ตก
