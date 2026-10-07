# SYSTEM CONNECTION MANUAL — PHASE 1 CENSUS (2026-09-01)

```
MODE = READ-ONLY CENSUS
ไม่แก้ canonical · ไม่สร้าง relationship · ไม่สร้าง connector · ไม่แตะ Settings
UNKNOWN คง UNKNOWN ทุกกรณี · ไม่มีการเลื่อนสถานะเอง
```

สำรวจว่าระบบที่มีอยู่จริงแต่ละตัว ตอบ **35 คำถามคู่มือการเชื่อมต่อ** ได้กี่ข้อ
จากทะเบียน / contract / เอกสาร / evidence / config ที่มีอยู่แล้วเท่านั้น

**ขอบเขตการอ่าน** จำกัดที่ path ที่ทะเบียนอ้างถึง + ไดเรกทอรีของระบบนั้น
(ลึกไม่เกิน 2 ชั้น ไฟล์ไม่เกิน 400KB) ไม่มีการสแกนรีโปแบบไร้ขอบเขต

---

## ตารางรวม

| SYSTEM | KIND | KNOWN | UNK | DECL | OBS | PRV | SRC | REL | CAP | EV | CONN | CRED |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Agent Gateway | SOFTWARE | **28/35** | 7 | 23 | 0 | 5 | 8 | 11 | 7 | 28 | 0 | 0 |
| Core | SOFTWARE | **27/35** | 8 | 20 | 3 | 4 | 3 | 7 | 4 | 15 | 0 | 0 |
| Machine Observer | SOFTWARE | 26/35 | 9 | 21 | 0 | 5 | 3 | 4 | 3 | 13 | 0 | 0 |
| n8n | SERVICE | 23/35 | 12 | 15 | 3 | 5 | 3 | 2 | 2 | 13 | **0** | 1 |
| GitHub | PROVIDER | 22/35 | 13 | 14 | 3 | 5 | 8 | 6 | 1 | 22 | **2** | 1 |
| Railway | PROVIDER | 22/35 | 13 | 14 | 3 | 5 | 2 | 1 | 1 | 8 | **0** | 1 |
| DigitalOcean | PROVIDER | 22/35 | 13 | 17 | 0 | 5 | 28 | 3 | 1 | 61 | **0** | 0 |
| Agent Registry | SOFTWARE | 22/35 | 13 | 17 | 0 | 5 | 28 | 1 | 1 | 216 | 0 | 0 |
| Registry DB | DATABASE | 22/35 | 13 | 17 | 0 | 5 | 5 | 8 | 2 | 36 | 0 | 0 |
| MCP | SERVICE | 22/35 | 13 | 17 | 0 | 5 | 3 | 4 | 2 | 12 | **0** | 0 |
| Supabase | DATABASE | 20/35 | 15 | 12 | 3 | 5 | 2 | 2 | 2 | 10 | **0** | 1 |
| OS UI | UI | 17/35 | 18 | 9 | 3 | 5 | 1 | 3 | 1 | 5 | 0 | 0 |
| Vercel | PROVIDER | 14/35 | 21 | 7 | 3 | 4 | 1 | **0** | 0 | 5 | **0** | 0 |
| Telemetry | SOFTWARE | 14/35 | 21 | 9 | 0 | 5 | 2 | 1 | 1 | 6 | 0 | 0 |
| Evidence Store | DATABASE | 11/35 | 24 | 6 | 0 | 5 | 1 | 3 | 1 | 3 | 0 | 0 |
| **Projection** | SOFTWARE | **5/35** | 30 | 2 | 0 | 3 | 1 | **0** | **0** | **0** | 0 | 0 |

`SRC` = source location · `REL` = relationship · `CAP` = capability ·
`EV` = evidence · `CONN` = connection ที่ลงทะเบียน · `CRED` = credential pointer

**เฉลี่ย 20.4 / 35 ข้อ (58%)**

---

## 1. สองคำถามที่ไม่มีระบบไหนตอบได้เลย

```
ข้อ 29  version/commit ที่ deploy อยู่   16/16 ระบบ ตอบไม่ได้
ข้อ 31  หน้า UI ไหนใช้ข้อมูลนี้           16/16 ระบบ ตอบไม่ได้
```

สองข้อนี้ตรงกับช่องว่างที่ Operational Lifecycle Model ระบุไว้ก่อนหน้าพอดี:
`commit_sha` ว่าง 0/589 และยังไม่มี entity `UI_SURFACE`

census ทำโดยไม่ได้อ้างอิงโมเดลนั้น แต่ชี้มาที่รูเดียวกัน — **เป็นการยืนยันซึ่งกันและกัน
ไม่ใช่การนับซ้ำ**

## 2. คำถามที่ระบบส่วนใหญ่ตอบไม่ได้

| ข้อ | คำถาม | ตอบไม่ได้ |
|---|---|---|
| 30 | rollback ได้ไหม ย้อนไปอะไร | 13/16 |
| 28 | deploy อยู่ที่ไหน | 12/16 |
| 8·9·10 | auth / credential type / pointer | 12/16 |
| 12·13 | ต้องตั้งค่าอะไร · ค่ามาจากไหน | 11/16 |
| 14–17 | input / output contract | 10/16 |
| 21·22 | เก็บที่ไหน · retrieval key | 10/16 |
| 23·24 | เรียกซ้ำได้ไหม · idempotency policy | 9/16 |

ข้อ 8·9·10 ที่ตอบไม่ได้ 12/16 **ไม่ใช่ข้อบกพร่อง** — ระบบภายในไม่ต้องใช้ credential
ข้ามพรมแดน ระบบภายนอกทั้ง 4 ตัวที่ต้องใช้ มี pointer ครบ

## 3. SECRET POLICY — ผ่าน

ทะเบียน credential เก็บ **pointer เท่านั้น** ตรงตามนโยบาย:

```
credential://github/t23598788-oss/-DNA-OS-INFRASTRUCTURE-/source-authority
     provider github  · scope ["repo"]              · ACTIVE
credential://railway/dna-os-infrastructure/production/project-token
     provider railway · scope READ_PROJECT_STATUS   · ACTIVE
credential://supabase/xeytcavxejhyzxwevgto/PROVIDER_ALERT_EMAIL_READ_SECRET
     provider supabase· scope INVOKE_EDGE_FUNCTION  · ACTIVE
credential://macos-keychain/dna-os/n8n-api-key
     provider n8n     · scope workflow.read/write   · ACTIVE
```

สแกนหา secret plaintext ในทุกไฟล์ที่ census อ่าน: **พบ 1 จุด และเป็น false positive**
— `transport/owner-command-http/tests/auth-gate.test.ts` มีค่าที่ตั้งชื่อตัวเองว่า
`test-only-secret-auth-gate-verification-…` ซึ่งเป็น fixture ของเทสต์ ไม่ใช่ของจริง

**ข้อ 11 (ห้ามแสดง secret จริง) = PROVEN ทั้ง 16 ระบบ**

หมายเหตุ: ไฟล์ `api-credential-references.jsonl` มี 134 แถว แต่ **130 แถวเป็น
test fixture** (`account: test-fixture-owner`) ของจริงมี 4 แถว — census กรอง
fixture ออกแล้ว แต่ตัวไฟล์ยังปนกันอยู่ ซึ่งทำให้ "นับ credential" ผิดได้ง่าย

## 4. Connection registry — schema ถูก แต่แทบว่างเปล่า

`connections/connection-registry/data/connections.jsonl` มี schema ตรงกับที่ต้องการพอดี
(`connection_id · account_id · software_id · adapter · credential_ref · status ·
connection_type · target · executor_capability_id · scope`)

แต่มี **2 แถว และทั้งคู่คือ GitHub connection เดียวกัน** (`connecting` → `connected`)

```
GitHub        2 connection ลงทะเบียน   ✓
Supabase      0                        ← มี credential แต่ไม่มีเส้นทาง
Railway       0                        ← มี credential แต่ไม่มีเส้นทาง
n8n           0                        ← มี credential แต่ไม่มีเส้นทาง
Vercel        0
DigitalOcean  0
MCP           0
```

Supabase / Railway / n8n เข้าเงื่อนไข **"พบระบบ แต่ยังไม่มีเส้นทางการใช้งานที่ลงทะเบียน"**
ตามที่โจทย์กำหนดให้แสดงตรง ๆ

## 5. runtime observation (OBSERVED)

ตรวจการเข้าถึงอย่างเดียว ไม่ใช้ credential:

```
Core          http://127.0.0.1:8791/runtime/inventory       200  OBSERVED
OS UI         http://127.0.0.1:5181/api/health              200  OBSERVED
n8n local     http://127.0.0.1:5678/healthz                 200  OBSERVED
GitHub        api.github.com/repos/…/-DNA-OS-INFRASTRUCTURE- 403  OBSERVED
Supabase      xeytcavxejhyzxwevgto.supabase.co/rest/v1/     401  OBSERVED
Railway       backboard.railway.com/graphql/v2              400  OBSERVED
Vercel        api.vercel.com/v2/user                        403  OBSERVED
n8n declared  n8n.srv1740014.hstgr.cloud/healthz            000  UNREACHABLE
```

403/401/400 = ปลายทางตอบจริง แค่ไม่ได้ยืนยันตัวตน จึงถือเป็น OBSERVED ได้
**n8n มีปลายทางที่ประกาศไว้ตายอยู่ ขณะที่ instance ที่รันจริงไม่ได้ถูกประกาศ**

## 6. สองระบบที่สถานะแย่ที่สุด

### Projection — 5/35 และไม่อยู่ในทะเบียนเลย

`control/owner-projection/` มีไฟล์จริง 2 ไฟล์ แต่ในทะเบียน canonical มี
**resource 0 · capability 0 · relationship 0 · evidence 0**

นี่คือชั้นที่ตัดสินว่า Owner จะเห็นอะไรบนหน้าจอ และมันไม่ปรากฏในทะเบียนของระบบตัวเอง

### Evidence Store — 11/35

ที่เก็บหลักฐาน มี evidence เกี่ยวกับตัวเองแค่ 3 แถว และตอบไม่ได้ว่าเก็บอะไร
ด้วย key อะไร (ข้อ 21·22) — ทั้งที่นั่นคือหน้าที่หลักของมัน

## 7. ช่องว่างเชิงโครงสร้าง

```
MISSING_RELATIONSHIPS            Vercel · Projection
MISSING_CONTRACTS                13 / 16 ระบบ ไม่มี input/output contract
MISSING_CONFIGURATION_METADATA   12 / 16 ระบบ ไม่มี env/config ที่ประกาศไว้
MISSING_CONNECTION_DECLARATION   6 ระบบภายนอก/บริการ (ยกเว้น GitHub)
```

---

## สิ่งที่ census นี้ยังไม่ทำ

- ไม่แก้ canonical
- ไม่สร้าง relationship / connection / connector
- ไม่แตะหน้า Settings
- ไม่เลื่อนสถานะใด ๆ ขึ้นเอง
- ไม่เดาค่าที่หาไม่เจอ — ทุกช่องที่ไม่มีข้อมูลถูกนับเป็น UNKNOWN

## ข้อสังเกตก่อนตัดสินใจ Phase 2

โครงที่ต้องใช้ **มีอยู่แล้วเกือบครบ** — connection registry มี schema ที่ถูก,
credential registry เก็บ pointer อย่างถูกต้อง, evidence มี 1,208 แถว

ที่ขาดไม่ใช่ "ที่เก็บข้อมูล" แต่คือ **แถวข้อมูล** — มี 1 connection ที่ลงทะเบียน
จากระบบภายนอก 6 ตัวที่ใช้งานอยู่จริง

การเติมข้อมูลนี้ต้องมาจากการประกาศที่มีหลักฐานรองรับ ไม่ใช่การเดาจากชื่อโฟลเดอร์
หรือจากการที่ระบบ "น่าจะ" เชื่อมกันอยู่
