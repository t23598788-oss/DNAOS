# control/capability-creation/ — capability เกิดมาพร้อมการเชื่อมต่อ ไม่ใช่พร้อมโค้ด

**หน้าที่:** ทำให้ *"เขียนโค้ดไว้ก่อน แล้วค่อยต่อทีหลัง"* เป็นไปไม่ได้เชิงโครงสร้าง
ไม่ใช่แค่นโยบายที่ต้องมีคนจำ — Owner instruction 2026-08-26

**การมี source code ไม่ทำให้สิ่งนั้นเป็น capability**

```
สัญญาการเกิด ── GATE 1 ──▶ PreWritePacket ──▶ Agent เขียน ── GATE 2 ──▶ OPERATIONAL
   (ครบไหม)      บล็อกถ้า      "implement only        (ต่อครบจริงไหม)    หรือ
                 UNKNOWN       this bounded            ตรวจกับของจริง    IMPLEMENTED_NOT_REACHABLE
                               capability."                              / OUTPUT_UNCONSUMED
                                                                         / ROUTING_MISSING
                                                              │
                                                              └─▶ parkMissingConnections()
                                                                  → control/work-continuation
```

## ไม่มีระบบที่สอง

| สิ่งที่ต้องใช้ | ใช้ของเดิม |
|---|---|
| ตัวตน/ทะเบียน | Registry + `registration-pipeline` + Duplicate Gate |
| แผนสถาปัตยกรรมก่อนเขียน | `control/work-resolution` |
| ความคืบหน้าของงาน | `control/work-session-state` |
| การรอ dependency แล้วถูกปลุก | `control/work-continuation` (index + evaluator เป็นของเขา) |
| write scope | `control/work-coordination` |
| runtime | `control/runtime-control` |
| การเห็นว่ามันรันจริง | `control/machine-observation` |

โฟลเดอร์นี้เก็บสิ่งเดียวที่ยังไม่มีเจ้าของ: **สัญญาการเกิดของ capability**

## GATE 1 — ก่อนเขียนไฟล์แรก

`evaluateCreationContract()` — 24 field + 4 list ต้องตอบได้ทั้งหมด
`UNKNOWN` = **บล็อก** ไม่ใช่คำเชิญให้ Agent ไปหาคำตอบเอง

`resource_id` / `capability_id` / `service_id` **ไม่ถูกบังคับที่นี่** เพราะ Registry
เป็นผู้มอบให้ตอน REGISTERED ซึ่งเกิดหลังจากนี้ — บังคับตอนนี้ = บังคับให้ใครสักคนแต่งเลข

`MANUAL_AGENT_INVOCATION` **ไม่อยู่ใน `TriggerClass`** โดยเจตนา: ถ้าทางเดียวที่มันจะถูก
เรียกคือมี Agent จำได้ แปลว่ามันยังไม่มี trigger

## GATE 2 — หลังโค้ดมีอยู่จริง

ตรวจ 8 อย่างกับของจริง ไม่ใช่กับคำประกาศ:
source มีจริง · Registry ออก id ให้แล้ว · **มีอะไรนอกโฟลเดอร์ตัวเองเรียกถึงจริง** ·
output มีผู้บริโภคที่มีอยู่จริง · มีเส้นทางจาก event ถึง capability · ประกาศวิธี invoke ·
**runtime จริงเคยเรียกมันแล้ว** · verification รันจริงและผ่านจริง

สถานะที่คืนคือ **ขั้นสุดท้ายที่ผ่านจริง** ไม่ใช่ขั้นที่ตั้งใจไว้ และชื่อความล้มเหลว
ตรงไปตรงมา: `IMPLEMENTED_NOT_REACHABLE` (มีโค้ด ไม่มีใครเรียกถึง) ·
`IMPLEMENTED_NOT_RUNTIME_PROVEN` (เทสต์ผ่าน แต่ runtime ไม่เคยเรียก)

## dependency key กับความพังที่เงียบที่สุด

`control/work-continuation/` จับคู่ด้วย **ความเท่ากันทั้งสตริง** ไม่มีการตัด prefix
ความเสี่ยงจึงไม่ใช่การชนกัน แต่คือ **near-miss**: `path:control/x` กับ
`path:control/x/` เป็นคนละสตริง ไม่มี error ไม่มี log งานแค่ไม่ตื่น —
ซึ่งหน้าตาเหมือน "ยังบล็อกอยู่ตามปกติ" เป๊ะ

จึงบังคับสองอย่าง: path ทุกอันผ่าน `normalizeScopePath` ตัวเดียวกับที่ write-scope ใช้
และส่วนที่เป็น capability ใช้ `capability_root` (รูปแบบ path ของ census) เสมอ
**ห้ามใช้ชื่อแสดงผลและห้ามใช้ segment สุดท้าย** — ทั้งสองอย่างเคยทำให้ registration
จริงหายไปจากสายตาในเรโปนี้มาแล้ว

`evidence_refs[]` ของแถวรอเก็บ key ที่สร้างไว้ด้วย เพื่อให้แถวที่ไม่เคยตื่น diff กับ
event ที่มาจริงได้ near-miss จะได้มองเห็น ไม่ใช่ดูเหมือนความอดทน

## สิ่งที่ห้ามแตะ

- ห้ามเขียน evaluator / reverse index / wake loop ที่นี่ — `control/work-continuation`
  เป็นเจ้าของทั้งสาม
- ห้าม mint `work_id` — ใช้ของที่ `control/work-session-state` ใช้อยู่
- ห้าม mint `resource_id`/`capability_id` — Registry เป็นผู้ออก
- ห้ามเพิ่มสถานะที่แปลว่า "เกือบใช้ได้" — มีแค่ `OPERATIONAL` กับสิ่งที่ยังไม่ใช่
- ห้ามยอมรับ output ที่ปลายทางเป็นไฟล์รายงานซึ่งไม่มีผู้อ่านจริง

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | ประเภท | หน้าที่ |
|---|---|---|
| `types.ts` | contract | สัญญาการเกิด, `TriggerClass`, `CapabilityLifecycleState`, `PreWritePacket` |
| `gate.ts` | source | GATE 1 + GATE 2 + ตัวสร้าง packet + `dependencyKey` ที่ normalize แล้ว |
| `store.ts` | source | journal ของสัญญาการเกิด + `parkMissingConnections` ที่ส่งต่อไป work-continuation |
| `events.ts` | source | **ครึ่งที่ยังไม่มีเจ้าของ** ของ event translator — 5 namespace เรื่องการต่อสาย |
| `production.ts` | source | ผู้เรียกจริงสองด้าน: `recordBlockedWork` และ `runContinuationJoin` |
| `contract.ts` | contract | **ไฟล์เดียวที่โฟลเดอร์อื่น import ได้** |
| `tests/creation-gate-proof.ts` | test | CASE A–E 15/15 |
| `tests/event-translator-proof.ts` | test | CASE A–G + targeted eval + production caller 15/15 |
| `tests/canonical-status-proof.ts` | test | สถานะระบบชนะรายงาน Agent 8/8 |

## วิธีรัน

```
npx tsx control/capability-creation/tests/creation-gate-proof.ts
```

## event translator — สองครึ่ง คนละเจ้าของ

translator ไม่ใช่ component เดียว มันคือสองครึ่งที่ต่างกันโดยธรรมชาติ:

| ครึ่ง | ผลิต namespace | เจ้าของ |
|---|---|---|
| ข้อเท็จจริงระดับระบบ (census / registry / verification / runtime) | `path` `registry` `runtime` `runtime_evidence` `verification` `capability` `resource` | `control/work-continuation/adapter.ts` |
| **ข้อเท็จจริงเรื่องการต่อสาย** | `trigger` `routing` `caller` `consumer` `contract_field` | `./events.ts` |

ครึ่งหลังเคยไม่มีผู้ผลิตเลย งานที่บล็อกด้วย 5 key นั้นจึงรอตลอดกาล —
พฤติกรรมถูก (ไม่ปลุกมั่ว) แต่ไม่มีวันจบ

`./events.ts` **ไม่ได้เฝ้าดูอะไร** มันเรียกประตูตัวเดิมกับสถานะจริง ณ ตอนนี้
แล้วปล่อย event เฉพาะ key ที่ "เคยขาด และตอนนี้ไม่ขาดแล้ว" เท่านั้น

## ผู้เรียกจริงใน production

| ด้าน | จุดจริง |
|---|---|
| งานติด → `appendWaiting` | `control/agent-gateway/gateway.ts#persistStatus` (UI render ปฏิเสธ) · `control/work-coordination/coordination.ts#transition` (ทั้งสองสาขาที่ปฏิเสธ) |
| verdict เป็นทางการ → join | `control/agent-gateway/gateway.ts#persistStatus` เฉพาะ `COMPLETED`/`FAILED` |

`runContinuationJoin` **ไม่ dispatch** decision ที่ได้ถูกบันทึกเป็นหลักฐาน แล้ว
`control/scheduler/` ตัวเดิมเป็นผู้หยิบไปทำ

`blockerKeysFor` รับเฉพาะ blocker ที่มีความหมายตายตัว ข้อความอื่น **คืนอาร์เรย์ว่าง
โดยตั้งใจ** — การเดา key จากประโยคอิสระจะได้ key ที่ไม่มีผู้ผลิตใดปล่อยออกมา
งานจะรอชั่วนิรันดร์โดยไม่มี error ซึ่งแย่กว่าการไม่บันทึก

## NOT_YET_BUILT

- **`runContinuationJoin` ยังเป็น `IMPLEMENTED_NOT_RUNTIME_PROVEN`** — สายไฟต่อครบ
  และพิสูจน์แล้วว่าทำงานได้ (`tests/continuation-runtime-proof.ts` 5/5: task จริง
  ผ่าน funnel จริง แล้ว production code เรียก join เอง) **แต่นั่นยังไม่ใช่
  runtime-proven** เพราะ proof ตั้ง `AGENT_GATEWAY_DATA_DIR` ไปที่ scratch dir
  หลักฐานที่มันอ่านจึงเป็นแถวที่ตัวมันเองเพิ่งทำให้เกิดและถูกลบทิ้งเมื่อจบ ·
  `control/agent-gateway/data/evidence.jsonl` ของจริงมีแถวจาก `runContinuationJoin`
  = **0** · กฎ "tests alone = IMPLEMENTED_NOT_RUNTIME_PROVEN" ใช้กับตัวเองเหมือนที่
  ใช้ปฏิเสธ email-alert-source · **ผมเคยอ้างว่ามัน runtime-proven แล้ว นั่นผิด
  แก้แล้ว 2026-08-26** — session ที่เป็นเจ้าของ work-continuation เป็นคนตรวจเจอ
- GATE 2 ยังไม่ถูกเรียกจาก `capability-promotion.ts` ให้ทุก candidate ต้องผ่าน
- `blockerKeysFor` รู้จัก blocker เพียง 2 แบบ (`UI_RENDER_NOT_VERIFIED:*`,
  `COMPLETION_PROVENANCE_UNRESOLVED`) blocker อื่นจะไม่ถูกบันทึกเป็นแถวรอ ซึ่ง
  ถูกต้องกว่าการเดา แต่แปลว่าความครอบคลุมยังไม่เต็ม
