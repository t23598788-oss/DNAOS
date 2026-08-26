# control/work-session-state/ — สถานะงานที่เป็นของ DNA OS ไม่ใช่ของ AI

**หน้าที่:** เก็บสถานะของงานที่กำลังทำค้างไว้บนดิสก์ ในรูปที่ worker คนใหม่
อ่านแล้วทำต่อได้ทันที **โดยไม่ต้องมีบทสนทนาเดิม ไม่ต้องมี memory ของ AI และ
ไม่ต้อง scan repo ทั้งก้อนใหม่** — Owner instruction 2026-08-26
("CLOSE ALL ARCHITECTURE DEBT AND PERSIST WORK STATE FOR RESUME").

**สิ่งนี้ไม่ใช่ task system ตัวที่สอง.** `control/work-coordination/` ยังเป็น
เจ้าของสถานะ task (`QUEUED`/`LOCKED`/`RUNNING`/`COMPLETED`/`FAILED`) และเจ้าของ
`target_files` แต่เพียงผู้เดียว ทุก checkpoint ที่นี่ **อ้าง** `task_id` ที่มี
อยู่แล้วที่นั่น ไม่ได้คัดลอกฟิลด์ status มาเก็บซ้ำ ถามสถานะ task ต้องไปถามที่
เดิมเสมอ

```
worker A ──appendCheckpoint──▶ checkpoints.jsonl ◀──buildResumeContext── worker B
   │                            (append-only)                                │
   └── ตายไป / ถูกปิด                    │                                    └── รู้ทุกอย่างที่ต้องรู้
                                          │
                        listWriteLocks() ──┴──▶ resolveChangeOwner(path) → work_id | UNKNOWN
                        (ของ work-coordination เดิม ไม่ได้เขียนใหม่)
```

**Input:** `appendCheckpoint()` จากใครก็ตามที่กำลังทำงานอยู่
**Output:** `buildResumeContext(work_id)` → `ResumeContext`,
`renderResumeBriefing()` → ข้อความบรรยายที่พอเพียงในตัวเอง,
`resolveChangeOwner(path)` → เจ้าของการเปลี่ยนแปลง หรือ `UNKNOWN`
**Dependency ที่อนุญาต:** Node built-ins + `../work-coordination/contract.ts`
(ใช้ lock directory และกฎ path containment เดิม ห้ามเขียนใหม่)

## สิ่งที่ห้ามแตะ

- **ห้ามแก้ record เดิมในที่เดิม** — journal เป็น append-only สถานะปัจจุบันคือ
  record สุดท้ายของ `work_id` นั้น ถ้าแก้ทับ writer ที่ตายกลางคันจะทิ้ง state
  ครึ่งใบไว้ ซึ่งเป็นสิ่งเดียวที่ระบบนี้มีไว้เพื่อกัน
- **ห้ามเชื่อ `state: "COMPLETED"` โดยไม่ตรวจ** — ทุก step ต้องพก
  `StepVerification` ที่ re-derive ได้ (`FILE_DIGEST` / `FILE_CONTAINS` /
  `PATH_EXISTS`) step ที่ไม่มีมันจะออกมาเป็น `UNVERIFIABLE` ไม่ใช่ผ่าน
- **ห้ามเดาเจ้าของการเปลี่ยนแปลง** — ไม่มีใครถือ lock และไม่มี active
  checkpoint ประกาศ path นั้น = `UNKNOWN` มีมากกว่าหนึ่ง = `UNKNOWN` แบบ
  `AMBIGUOUS` ห้ามหยิบอันแรก
- **ห้ามให้ AI ตัดสิน `next_action`** — มันมาจาก step graph, blocker และ
  decision ที่บันทึกไว้ ผ่านกฎเดียวใน `./resume.ts#decideNext`
- **ห้ามลบ/ตัด journal ที่นี่** — โฟลเดอร์นี้ไม่มีสิทธิ์ลบข้อมูล

## ไฟล์ในโฟลเดอร์นี้

| ไฟล์ | ประเภท | หน้าที่ |
|---|---|---|
| `types.ts` | contract | `WorkSessionCheckpoint`, `WorkStep`, `ResumeContext`, `ChangeOwnership` |
| `store.ts` | source | journal แบบ append-only + reduce เป็นสถานะปัจจุบัน + revision จาก git จริง |
| `resume.ts` | source | resume engine — ตรวจ step ที่อ้างว่าเสร็จซ้ำ แล้วตัดสิน next action |
| `ownership.ts` | source | path → work_id หรือ UNKNOWN โดยใช้ lock/scope ที่มีอยู่แล้ว |
| `contract.ts` | contract | **ไฟล์เดียวที่โฟลเดอร์อื่น import ได้** |
| `tests/worker-a.ts` | entrypoint | worker ตัวแรกของ hard-reset proof — เขียน checkpoint แล้วตาย |
| `tests/worker-b.ts` | entrypoint | worker แทนที่ — ได้รับแค่ `work_id` ไม่มีอย่างอื่นเลย |
| `tests/hard-reset-resume-proof.ts` | test | PHASE 9 — พิสูจน์ A→J ครบ 14 ข้อ |
| `tests/change-ownership-proof.ts` | test | PHASE 6 — พิสูจน์ว่า UNKNOWN คือคำตอบจริง ไม่ใช่การเดา |
| `journal.ts` | source | UNSAVED WORK JOURNAL — `INTENT → JOURNALED → APPLIED → CHECKPOINTED → VERIFIED → COMMITTED` |
| `connection.ts` | source | สถานะ connection + backoff ที่มีเพดาน + reconcile + คิว `WAITING_FOR_NETWORK` |
| `rehydrate.ts` | source | แผนคืนชีพ UI จาก durable state + กู้ runtime ผ่าน `../runtime-control/` |
| `VOLATILE_STATE_INVENTORY.md` | doc | state ที่เคยอยู่แต่ใน RAM/เบราว์เซอร์ พร้อมการจำแนกทีละรายการ |
| `tests/crash-consistency-proof.ts` | test | เคส A–F 28/28 — ฆ่า process จริง, ไฟล์จริง, อ่านกลับจากดิสก์จริง |
| `tests/live-service-recovery-proof.ts` | test | ยิง joint-monitor จริง → SIGKILL → ยิงใหม่ → SSE resume ด้วย `Last-Event-ID` จริง |
| `tests/browser-rehydration-proof.ts` | test | เบราว์เซอร์ profile ใหม่เอี่ยม render งานที่มันไม่มีทางรู้มาก่อน |

## วิธีรัน

```
npx tsx control/work-session-state/tests/hard-reset-resume-proof.ts
npx tsx control/work-session-state/tests/change-ownership-proof.ts
npx tsx control/work-session-state/tests/crash-consistency-proof.ts
npx tsx control/work-session-state/tests/live-service-recovery-proof.ts
npx tsx control/work-session-state/tests/browser-rehydration-proof.ts

# อ่านสถานะงานจริงบนเครื่องนี้
npx tsx -e 'const {allCurrentCheckpoints,buildResumeContext,renderResumeBriefing}=require("./control/work-session-state/contract"); for (const c of allCurrentCheckpoints()) console.log(renderResumeBriefing(buildResumeContext(c.work_id)),"\n")'
```

`WORK_SESSION_STATE_ROOT` ชี้ journal ไปที่อื่นได้ (proof ใช้ค่านี้เพื่อไม่เขียน
ทับของจริง) ค่าปริยายคือ `local-runtime/work-session-state/checkpoints.jsonl`

## เส้นทางอ่านที่ประกาศไว้แล้ว

`control/system-read-paths/` ประกาศสองเส้นทางนี้ และ verifier ยืนยันว่า symbol
มีจริงบน contract:

- `RP-WORK-RESUME-STATE` → `buildResumeContext` · provenance `HISTORY`
- `RP-CHANGE-OWNER` → `resolveChangeOwner` · provenance `RUNTIME`

## DURABLE RUNTIME (เพิ่ม 2026-08-26)

ดู `VOLATILE_STATE_INVENTORY.md` สำหรับการจำแนกทีละรายการ สรุปหลักการ:

- **commit ไม่ใช่ขอบเขตความถาวรแรก** — `journal.ts` บันทึกเจตนา + draft + digest
  ก่อนแตะไฟล์จริง `recoverableEntries()` ดูสิ่งที่ **ไฟล์บอก** ไม่ใช่แค่สิ่งที่
  journal อ้าง: entry ที่บันทึกไว้ว่า `JOURNALED` แต่ไฟล์เป้าหมายเปลี่ยนไปแล้ว
  จะได้ `RESUME_AFTER_APPLY` ไม่ใช่ `REAPPLY` — การเขียน draft ทับไฟล์ที่มีมันอยู่แล้ว
  คือวิธีที่ crash recovery ทำงานพัง
- **อายุ connection ≠ อายุงาน** — backoff มีเพดานประกาศไว้ (500ms → 30s, ยอม 12 ครั้ง)
  และ resume point ที่ producer วางไม่ถูก **บังคับ full resync** ไม่ใช่ตอบว่า
  "คุณไม่พลาดอะไร"
- **ไม่มีเน็ต ≠ งานหยุด** — งาน local เดินต่อ ส่วนที่ต้องใช้เน็ตเข้าคิวพร้อม
  provider/next_action/evidence และ drain เองเมื่อเน็ตกลับมา **ยกเว้น**
  operation ที่ต้องการอำนาจตัดสินใจของ Owner ซึ่ง drain ไม่มีวันทำแทน
- **เบราว์เซอร์ถูก "บอก" ไม่ใช่ถูก "ถาม"** — `ui_context` อยู่บน checkpoint
  `buildRehydrationPlan()` สร้างแผนได้โดยไม่ต้องมีเบราว์เซอร์หรือ runtime เปิดอยู่เลย
- **กู้ runtime ผ่านเจ้าของอำนาจเดิม** — `recoverRuntime()` เรียก
  `control/runtime-control#runOperation` ซึ่งเป็นตัวเดียวที่ตัดสินว่าขึ้นแล้วหรือยัง
  ไฟล์นี้ไม่ probe health ซ้ำ เพราะความเห็นที่สองเรื่อง "service ขึ้นหรือยัง"
  คือสิ่งที่ header ของ capability นั้นห้ามไว้

## NOT_YET_BUILT

- ยังไม่มีใครเรียก `appendCheckpoint` จาก production path — วันนี้ checkpoint
  ถูกเขียนโดย worker/proof และโดยมือ ยังไม่ได้ผูกเข้ากับ
  `control/agent-gateway/` ให้เขียนอัตโนมัติทุก execution
- ยังไม่มี network prober จริง — `drainQueue` รับ `isOnline(provider)` เข้ามา
  ผู้เรียกต้องหามาเอง ประกาศเป็น `UNRESOLVED` ไม่ได้ตั้งค่าเงียบ ๆ
- `nextBackoffMs` ไม่มี jitter (deterministic เพื่อให้ proof ยืนยันลำดับได้)
  client จำนวนมากจะ retry พร้อมกัน — `UD-CONN-01`
- `retention` ของ journal ยังไม่ประกาศ — ไฟล์โตขึ้นเรื่อย ๆ `control/machine-observation/`
  มี policy ของตัวเองแล้ว แต่ยังไม่มีการประกาศสำหรับไฟล์นี้ ระบุไว้ตรง ๆ
  แทนที่จะตั้งค่าเงียบ ๆ เอง
