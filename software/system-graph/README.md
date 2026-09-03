# system-graph — วงจรจริงของ DNA OS

**หน้าที่:** ตอบคำถามเดียว — "ตอนนี้ระบบต่อกันยังไงจริง ๆ" เป็น nodes/edges
ที่ทุกเส้นมีหลักฐาน

**มันไม่ค้นหาอะไรเอง** ทุก node ทุก edge อ่านมาจาก producer ที่พิสูจน์ไว้แล้ว:

| producer | ให้อะไร |
|---|---|
| `../live-census/` | 138 capability record: path, domain, boundary, dependencies, runtime_state, current_status, evidence |
| `../live-census/#deriveEdges` | เส้น dependency พร้อม state/reason ที่ capability นั้นคำนวณเอง |
| `../../observability/joint-monitor/data/joints.jsonl` | การเรียกจริงที่สังเกตได้ พร้อมเวลา — **แหล่งเดียว**ที่ทำให้เส้นเป็น ACTIVE |
| `../../control/runtime-control/#SERVICES` | service ที่ launchd ประกาศ + health จริง |
| `credentials/registry/` | provider ที่มี credential reference |

**Input:** ไม่มี (อ่าน record ที่ persist ไว้)
**Output:** `buildSystemGraph` และ type ของกราฟ
**Dependency ที่อนุญาต:** `../live-census/contract.ts`,
`../../control/runtime-control/contract.ts`, node built-ins

**สิ่งที่ห้ามแตะ:**
- **NO EVIDENCE = NO EDGE** — `edge()` ปฏิเสธทุกเส้นที่ `evidence_ref` ว่าง
  และนับไว้ใน `unresolved` ไม่ใช่กลืนหาย
- ห้ามลากเส้นเพราะสองอย่างอยู่โฟลเดอร์เดียวกัน ชื่อคล้ายกัน หรืออยู่ใกล้กันบนจอ
- ห้ามแปลง UNKNOWN เป็นผ่านหรือพัง
- ห้ามขยาย `ACTIVITY_WINDOW_MS` เพื่อให้กราฟดูคึกคักกว่าที่เครื่องเป็นจริง
- ห้ามเพิ่ม scanner ที่นี่ — ไฟล์นี้มีสิทธิ์ **join** เท่านั้น ไม่มีสิทธิ์ **ตัดสิน**
  ถ้าเพิ่ม จะกลายเป็นความเห็นที่สองเรื่องสถาปัตยกรรม แล้ว repo จะมีสองคำตอบ
  ต่อคำถามเดียวกัน

## ที่ยังตอบไม่ได้ (รายงานไว้ใน `unresolved` ทุกครั้ง)

- การเรียกที่ชี้ไปสิ่งที่ census ไม่รู้จัก (ไฟล์เทสต์ ชื่อลอย ๆ) — รายงาน ไม่วาด
- service ที่ entrypoint อยู่นอก repo นี้ (เช่น `lab-ui` อยู่ใน
  DNA-LAB-PERMISSION-REASONER) — ไม่มีเส้น เพราะปลายทางไม่ได้อยู่ในกราฟนี้
- สถานะจริงของ provider ภายนอก — ไม่มี producer ไหนวัด จึงเป็น UNKNOWN
