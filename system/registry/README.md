# Registry — ประตูทางเข้า

## Layer Stack (2026-07-07)

```
Constitution        ↓  กำหนดกฎหมาย                 registry/CONSTITUTION.json
Execution Contract  ↓  กำหนดวิธีปฏิบัติตามกฎหมาย    registry/EXECUTION_CONTRACT.json
Runtime             ↓  บังคับใช้
Scheduler           ↓  แจกงาน                       registry/SCHEDULER.json + LOCK_MANAGER.json
Workers             ↓  ลงมือทำ                      registry/AI_REGISTRY.json + AI_SESSIONS.json
```

Constitution กับ Execution Contract แยกกันโดยตั้งใจ — ถ้าวันหนึ่งเปลี่ยน Runtime (Node.js → Rust/Go หรือกระจายหลายเครื่อง) แทบไม่ต้องแตะ Constitution เลย เพราะสิ่งที่เปลี่ยนคือ "วิธีรัน" ไม่ใช่ "กฎของระบบ" (รายละเอียดที่ `registry/CONSTITUTION.json` → `layer_stack`)

## DNA OS Unified AI Runtime (v1, ล็อกโดยเจ้าของระบบ 2026-07-07)

**Objective:** DNA OS เป็น multi-agent execution environment — AI หลายตัว หลายค่าย ทำงานพร้อมกันได้จริง ไม่ผูกกับค่ายใดค่ายหนึ่ง (AI-agnostic) AI ตัวไหนก็ได้ที่ทำตาม protocol นี้ถือว่าเป็น **DNA OS Compatible** (นิยามเต็มที่ `registry/AI_REGISTRY.json` → `compatibility_contract`)

**DNA OS Runtime Contract** (`registry/CONSTITUTION.json` → `runtime_contract`): Runtime=CPU, Registry=Memory, Scheduler=Process Scheduler, Event Engine=Interrupt Controller, Connector=Device Driver, Workflow=Program. **AI ทุกตัวเป็น Worker ไม่ใช่ Runtime** — ห้ามเขียน Source โดยไม่ผ่าน Runtime, มีแต่ Runtime เท่านั้นที่เปลี่ยน State ของระบบ, ทุกโมดูลต่อผ่าน Runtime เท่านั้น ห้ามเชื่อมกันโดยตรง

**สำคัญ:** AI ไม่ได้เชื่อฟัง Runtime — **AI เชื่อฟังกฎ** (Constitution + Runtime Contract) Runtime เป็นเพียง**ตัวบังคับใช้กฎ** (= Rule Engine / Governance Engine) ไม่ใช่ผู้มีอำนาจออกกฎเอง (ดู `runtime_contract.authority_model`) — เพราะแบบนี้ AI ค่ายใหม่จึงเข้าระบบได้ทันทีแค่ทำตาม Constitution + Runtime Contract โดยไม่ต้องแก้ Runtime เลย

**ต่อไปนี้คือเนื้อหาของ `registry/EXECUTION_CONTRACT.json` (แสดงที่นี่เพื่อให้อ่านง่าย — ไฟล์ JSON คือ source of truth ถ้าไม่ตรงกันให้ยึด JSON):**

### Communication Rules

1. ห้าม AI คุยกับ AI ตัวอื่นโดยตรง
2. AI ทุกตัวสื่อสารผ่าน DNA OS Registry เท่านั้น
3. ห้ามสันนิษฐานงานของ AI ตัวอื่น — อ่าน Registry ก่อนลงมือทุกครั้ง

### Execution Order

-1. **(2026-07-15, DNA-000066)** Read `MASTER_EXECUTION_STATE.md` (repo root) first — a human-readable rendering of `CURRENT_STATE.json` + `TASK_QUEUE.json` + `architecture-book.json`'s real module summary, built specifically so a new AI session does not have to read all 65+ `CHANGELOG.json` entries to get oriented. It is a VIEW, not a second source of truth — if it disagrees with the JSON registries below, they win; regenerate it, don't trust it blindly.
0. **(SDRN-P1, 2026-07-14)** Run `npm run hello` (`scripts/hello.ts`) first if available — it reads steps 1-6 below in one pass and prints Identity/Current State/Phase/Architecture/Health/Priority/Known Problems/Blocked Areas/Available Work/Recommended Task/Warnings/Recently Changed/Learning Updates as one combined report, plus demonstrates the Document Engine's Self Description Interface (`engines/documents/selfDescription.ts` — the only one of 466 modules wired so far; scope deliberately narrow, see `registry/GOVERNANCE_REGISTRY.json` → SDRN). This does not replace steps 1-6 — it is a faster first read of the same real files, not a new source of truth.
1. Read `registry/README.md` (ไฟล์นี้)
2. Read `registry/CONSTITUTION.json`
3. Read `registry/CURRENT_STATE.json`
4. Read `registry/AI_SESSIONS.json` — upsert entry ของตัวเอง (`agent_id`, `status: "working"`)
5. Read `registry/LOCK_MANAGER.json` — ห้ามแตะไฟล์ที่มี lock อยู่แล้วโดย agent อื่น
6. Read `registry/TASK_QUEUE.json` และ `registry/SCHEDULER.json`
7. เลือกงานที่ยังว่าง (ไม่มีใคร lock path นั้นอยู่) → lock เฉพาะไฟล์ที่ต้องแก้ใน `LOCK_MANAGER.json` → Execute — ทำต่อจาก `CURRENT_STATE.next_step` **เท่านั้น** ห้ามเริ่มงานใหม่จากศูนย์ ถ้าไม่มีงานว่างเลย → หยุดรอ (do nothing, wait)
8. Update `CURRENT_STATE.json`
9. Append `CHANGELOG.json` (ดูรูปแบบ output ด้านล่าง)
10. Release lock — ลบ entry ของตัวเองออกจาก `LOCK_MANAGER.json`
11. Update `AI_SESSIONS.json` — สถานะตัวเองให้ตรงความจริง (`idle`/`blocked`/`token_exhausted`/`submitted`) ห้ามปล่อยเป็น `working` ค้าง
12. Exit

### Execution Rules

- Lock เฉพาะไฟล์ที่ตัวเองแก้ ห้าม lock ทั้งโปรเจกต์
- หลาย agent ทำงานพร้อมกันได้ ตราบใดที่ไม่แตะไฟล์เดียวกัน
- ห้ามแก้ไฟล์ที่ถูก lock อยู่
- ห้าม overwrite งานของ agent อื่น
- ห้ามสร้าง architecture ซ้ำ
- ห้ามสร้าง parallel implementation
- ห้ามเปลี่ยนชื่อไฟล์ registry ที่มีอยู่แล้ว (ยกเว้นเจ้าของระบบสั่งเองโดยตรง — เทียบเท่าการแก้ Constitution)
- ห้าม hardcode ข้อมูลธุรกิจ
- อ่าน Constitution ก่อนเขียนโค้ดเสมอ
- Registry คือ single source of truth
- ก่อนหยุดงาน `CURRENT_STATE.json` ต้องมีครบ: `status` (`IN_PROGRESS`/`BLOCKED`/`DONE`), `current_file`, `next_step`, `handoff`, `open_questions`
- ทิ้ง repository ไว้ในสถานะที่ทำต่อได้เสมอ — AI ตัวต่อไปต้องทำต่อได้โดยไม่ต้องถามผู้ใช้ ถ้าจำเป็นต้องรอการตัดสินใจของมนุษย์จริงๆ `status: BLOCKED` พร้อม `open_question` ที่ชัดเจน **คือ** สถานะที่ทำต่อได้แล้ว (ห้ามเดาคำตอบเพื่อปลดล็อกเอง)

### Output — ทุก task ที่ทำเสร็จต้องเขียนลง CHANGELOG.json ด้วย field ครบนี้

```
change_id, agent_id, provider, model, session_id,
files_modified, started_at, finished_at, status, summary, next_task
```

One Entry. One Architecture. One Registry. One Source of Truth.

## ไฟล์หลักในโฟลเดอร์นี้

ไฟล์สถานะแต่ละไฟล์มีหน้าที่เดียว ห้ามผสมกัน:

- `CONSTITUTION.json` — กฎหมายสูงสุดของระบบในรูปแบบ JSON (CLAUDE.md คือ human-readable version ของไฟล์นี้ ถ้าไม่ตรงกันให้ยึด JSON เป็นหลัก) — เป็นเรื่อง "กฎคืออะไร" เท่านั้น ไม่ใช่ "ทำตามกฎยังไง"
- `EXECUTION_CONTRACT.json` — "ทำตามกฎยังไง": Communication Rules, Execution Order, Execution Rules, Output contract — แยกออกจาก `CONSTITUTION.json` โดยตั้งใจ (ดู Layer Stack ด้านบน) เพื่อให้เปลี่ยน Runtime ได้โดยไม่ต้องแตะกฎหมายของระบบ
- `CURRENT_STATE.json` — สถานะของ "การเปลี่ยนแปลง" (change_id, status, current_task, current_file, next_step, handoff, open_questions) — คงอยู่ข้าม session จนกว่าจะ `DONE`
- `LOCK_MANAGER.json` — per-file lock ledger (มาแทน `WORK_LOCK.json` เดิมซึ่งเป็น single-lock ตัวเดียว) — `locks[]` เป็น array, หลาย agent lock กันคนละไฟล์พร้อมกันได้จริง lock เฉพาะไฟล์ที่แก้ ห้าม lock ทั้งโปรเจกต์ ปลด lock ด้วยการลบ entry ออก
- `AI_SESSIONS.json` — live roster ของแต่ละ AI **session/instance** จริง (agent_id, provider, model, session_id, started_at, last_seen, status: working/idle/blocked/token_exhausted/submitted/unknown) — ตอบคำถาม "ใครกำลังทำ ใครพัก ใคร token หมด ใครส่งงานแล้ว" ไม่ใช่แค่ "มี AI ประเภทไหนบ้าง" (นั่นคือหน้าที่ของ `AI_REGISTRY.json`) — ห้ามเดาค่า field ที่ไม่มีหลักฐานจริง ใส่ `null` พร้อม note แทน
- `HANDOFF.json` — บันทึก "รอบล่าสุด" ทำอะไรเสร็จ (`finished`), เหลืออะไร (`next`), และทำไมถึงหยุด (`reason` — เช่น token limit หรือรอ user ยืนยัน) ถูกเขียนทับทุกครั้งที่จบ session
- `AI_REGISTRY.json` — `compatibility_contract` (นิยามว่า AI แบบไหนถือเป็น DNA OS Compatible) + directory ของ agent **type** ที่รู้จัก (claude-code, gemini-cli, chatgpt, copilot, cursor, windsurf, qwen, deepseek, kimi, grok, mistral, llama, custom, ฯลฯ) — เป็น static list ของประเภท ไม่ใช่ instance จริง (ดู `AI_SESSIONS.json`), ไม่ใช่ whitelist, ไม่ผูกกับค่ายใดค่ายหนึ่ง
- `SCHEDULER.json` — งาน feature ใหญ่ที่กำหนดขอบเขตเป็น **path** (`task`, `assigned_to: "Any"` เสมอ — ไม่ผูกกับ AI ตัวไหนล่วงหน้า, `path`, `priority`, `status`) ต่างจาก `TASK_QUEUE.json` ซึ่งเป็น backlog ของงานย่อยแบบ atomic — agent เลือกงานจากที่นี่โดยดู path ที่ยังไม่ถูก lock ใน `LOCK_MANAGER.json`
- `TASK_QUEUE.json` — งานที่รอทำ
- `CHANGELOG.json` — ประวัติทุกการเปลี่ยนแปลง (array, เก่าสุดก่อน)
- `architecture.json` — layer/module map (Core/Gateway/Engines/Cognitive/Presenter/Services/Plugins/Registry)
- `architecture-book.json` — สถานะสุขภาพของระบบ (OK/BROKEN/UNUSED/UNREGISTERED), สร้างจาก `scripts/build-arch-book.ts`
- `module-registry.json` — ทะเบียนทุกโมดูล (auto-synced จาก `scripts/sync-registry.ts`)
- `dependency-graph.json` — กฎการ import ข้าม layer
- `portals.json` — Portal Registry (Control Center, Developer/User/Partner/Business Portal, Download Center)
- `connector-lifecycle.json` — มาตรฐานล็อกของ Connector Lifecycle (Connect→Register→Test→Enable→Run)
- `owner-context.json` — ตัวตน/เจตนา/เป้าหมายของเจ้าของระบบ (ห้ามเดาเนื้อหานี้)
