# VOLATILE STATE INVENTORY — 2026-08-26

**PROCESS IS EPHEMERAL · WORK STATE IS DURABLE · UI IS A PROJECTION OF DURABLE STATE**

การจำแนกทุกแถวมาจากการอ่านโค้ดจริงและรันจริง ไม่ใช่จากการเดา
`DERIVABLE` แปลว่า **มีทางสร้างกลับได้จากของถาวรที่มีอยู่แล้ว และทางนั้นถูกเรียกใช้จริง** —
ถ้ามีของถาวรอยู่แต่ไม่เคยมีใครอ่านกลับ นั่นไม่ใช่ `DERIVABLE` แต่คือบั๊ก

| ที่อยู่ของ state | มันคืออะไร | จำแนก | เหตุผล / สิ่งที่ทำไป |
|---|---|---|---|
| `dna-os-circuit/runtime/circuit-state.ts` `CircuitState` | สถานะ node/edge ของ circuit | `DERIVABLE` | `start.ts` เรียก `initializeCircuitFromRepo(state)` ทุกครั้งที่บูต — สร้างกลับจาก repo จริง ไม่ใช่สำเนาเดียวในโลก |
| `observability/joint-monitor/joint-store.ts` ring buffer | joint/violation ล่าสุดในหน่วยความจำ | **`MUST_PERSIST` → แก้แล้ว** | เขียนลง `data/joints.jsonl` มาตั้งแต่ 2026-08-22 แต่**ไม่เคยอ่านกลับ** collector ที่รีสตาร์ตจึงเสิร์ฟ snapshot ว่างเปล่าข้าง ๆ ไฟล์ที่มีข้อมูลครบ เพิ่ม `rehydrate()` ที่บูต |
| SSE frame ที่ client ประมวลผลไปแล้ว | ตำแหน่งของ client บน stream | **`MUST_PERSIST` → แก้แล้ว** | frame ไม่มี `id:` เลย ทำให้ reconnect ไม่มีจุดอ้างอิง เพิ่ม `id:`/`retry:` + `Last-Event-ID` + `eventsSince()` |
| การเชื่อมต่อ SSE/WebSocket เอง | socket ที่เปิดค้าง | `EPHEMERAL_OK` | ของใช้แล้วทิ้ง — แต่ **สถานะของมัน** เป็น `MUST_PERSIST` และไปอยู่ที่ `connections.jsonl` |
| `server.ts` inline viewer `state = new Map()` | ตารางแถวในหน้าเว็บ | `EPHEMERAL_OK` | อยู่ในเบราว์เซอร์ สร้างใหม่จาก snapshot ทุกครั้งที่ต่อติด — และ snapshot นั้นตอนนี้มาจาก durable log แล้ว |
| `circuit-board.js` / `system-graph/index.html` DOM | ภาพที่เห็นบนจอ | `EPHEMERAL_OK` | ทั้งสองหน้า refetch จาก endpoint ไม่ได้ถือ state ที่ผู้ใช้แก้ไว้ |
| route/view ที่ operator กำลังดู | เบราว์เซอร์อยู่หน้าไหน | **`MUST_PERSIST` → แก้แล้ว** | เดิมอยู่ในแท็บที่เปิดอยู่เท่านั้น ปิดแท็บแล้วหาย เพิ่ม `ui_context` บน checkpoint + `buildRehydrationPlan()` ที่ **บอก** เบราว์เซอร์ว่าต้องไปไหน |
| ความคืบหน้าของงานใน process ของ worker/AI | ทำถึงไหน อะไรพิสูจน์แล้ว | **`MUST_PERSIST` → มีแล้ว** | `checkpoints.jsonl` (เฟสก่อนหน้า) |
| **เจตนาแก้ไขที่ยังไม่ commit** | draft + target + digest ก่อนแก้ | **`MUST_PERSIST` → แก้แล้ว** | เดิมขอบเขตความถาวรแรกคือ commit ตายก่อนนั้น = หายทั้งหมด เพิ่ม `work-journal.jsonl` |
| operation ที่ต้องใช้เน็ตแต่เน็ตไม่มี | คำสั่งที่ยิงไม่ออก | **`MUST_PERSIST` → แก้แล้ว** | เดิมกลายเป็น error ที่หายไป ต้องให้ Owner พิมพ์ใหม่ เพิ่ม `network-queue.jsonl` + `WAITING_FOR_NETWORK` |
| `dna-os-circuit/runtime/finding-*.ts` `let existing: []` | buffer ชั่วคราวระหว่างคำนวณ | `EPHEMERAL_OK` | อ่านจากไฟล์ ประมวลผล เขียนกลับ ภายในฟังก์ชันเดียว ไม่มีอะไรอยู่ข้ามคำเรียก |
| `ChangeEmitter` listener set (ทั้งสองที่) | ใครกำลังฟังอยู่ | `EPHEMERAL_OK` | ผู้ฟังลงทะเบียนใหม่เองตอนต่อติด และการจากไปของผู้ฟังไม่ใช่ข้อมูล |
| `local-runtime/*.log` ของ LaunchAgent | stdout ของ service | `EPHEMERAL_OK` | launchd เขียนเอง ไม่มีใครอ่านกลับเป็น state |
| การตัดสินใจว่า provider ไหน online | ผลการ probe เน็ต | `UNRESOLVED` | วันนี้ `drainQueue` รับ `isOnline(provider)` เป็น callback ยังไม่มี prober จริงในระบบ ประกาศไว้ตรง ๆ ไม่ตั้งค่าเงียบ ๆ |
| jitter ของ backoff | การกระจายเวลา retry | `UNRESOLVED` | `nextBackoffMs` เป็น deterministic เพื่อให้ proof ยืนยันลำดับได้ ผลข้างเคียงคือ client จำนวนมากจะ retry พร้อมกัน — `UD-CONN-01` |

## DURABLE STATE BOUNDARY

```
เจตนาจะแก้            →  work-journal.jsonl        (ก่อนแตะไฟล์จริง)
งานคืบหน้า            →  checkpoints.jsonl         (ก่อนยอมรับว่าคืบ)
event ที่ประมวลผลแล้ว  →  connections.jsonl         (ก่อนยอมให้ตัดการเชื่อมต่อนับ)
คำสั่งที่รอเน็ต        →  network-queue.jsonl       (แทนที่จะ error หายไป)
joint/violation       →  observability/joint-monitor/data/*.jsonl  (อ่านกลับตอนบูตแล้ว)
```

ทุกไฟล์ append-only · สถานะปัจจุบัน = record สุดท้ายของ key นั้น · บรรทัดสุดท้ายที่เขียนไม่จบ
(รูปร่างปกติของ writer ที่ถูกฆ่า) ถูก **ข้าม** ไม่ใช่ซ่อมหรือเดา
