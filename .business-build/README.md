# DNA OS Developer Guide

## AI Execution Protocol (อ่านก่อนเริ่มงานทุกครั้ง)

ศูนย์บัญชาการอยู่ที่ `registry/` — ห้ามสร้างไฟล์สถานะซ้ำที่อื่น เริ่มงานทุกครั้งตามลำดับ:

```
README.md (ไฟล์นี้)
   ↓
registry/CURRENT_STATE.json   ← งานที่ค้างอยู่, ใครทำล่าสุด, ทำต่อจากตรงไหน
   ↓
registry/TASK_QUEUE.json      ← งานที่รอทำ เรียงตาม priority
   ↓
registry/*.json               ← architecture, module-registry, dependency-graph, portals, ฯลฯ
   ↓
ทำงาน
   ↓
registry/CHANGELOG.json       ← บันทึกการเปลี่ยนแปลง อ้างอิงด้วย change_id
   ↓
registry/CURRENT_STATE.json   ← อัปเดตก่อนจบเสมอ
```

รายละเอียดทั้งหมดอยู่ที่ [`registry/README.md`](registry/README.md) ห้ามเดา ห้ามสมมติ ห้าม hardcode ห้ามเริ่มงานใหม่ถ้า `registry/CURRENT_STATE.json` มี `current_task` ค้างอยู่ (status ไม่ใช่ `DONE`) — ให้ทำต่อจาก `next_step`/`handoff` เท่านั้น เจอปัญหาให้วิเคราะห์และยืนยันสาเหตุก่อน ห้ามแก้ทันที

## ภาพรวม

DNA OS คือระบบปฏิบัติการทางธุรกิจที่สร้างขึ้นจากหลักการเฝ้าดูตัวเอง (Self-Observation) โดยมีเจตนาหลักคือ **"เฝ้าระวังตัวเองไม่ให้ไปสร้างความเดือดร้อนให้คนอื่น"** ซึ่งถูกแปลมาเป็นสถาปัตยกรรมและข้อจำกัดต่างๆ ในโค้ด. [1]

ระบบไม่ได้ฉลาดเพราะ AI แต่ฉลาดเพราะ **"ข้อจำกัด"** ของแต่ละโมดูลที่บังคับให้เกิดการทำงานร่วมกันอย่างเป็นระบบ คล้ายกับการที่สมองสั่งงานร่างกายผ่านเส้นประสาทที่แยกส่วนกัน. [8]

## โครงสร้างสถาปัตยกรรม (Layered Architecture)

DNA OS ใช้สถาปัตยกรรมแบบ Layered ซึ่งแต่ละชั้น (Layer) มีหน้าที่และความรับผิดชอบที่ชัดเจนตามที่ระบุไว้ใน `registry/architecture.json`. [2]

### 1. Core
*   **หน้าที่**: เป็นแกนกลางของ Runtime, ไม่เคยเปลี่ยนแปลง (never forks) และเป็นศูนย์รวมของกฎเกณฑ์และความจริงสูงสุด (Single Source of Truth) ของระบบ. [2, 16]
*   **หลักการสำคัญ**: Core จะรู้จักแค่ "สัญญา" (Contract) ของโมดูล แต่ไม่รู้จักตัวตนหรือชื่อของโมดูลนั้นๆ โดยตรง (Law 1). [16]
*   **โมดูลตัวอย่าง**:
    *   `runtime/engine`: เครื่องยนต์หลักสำหรับโหลด Registry, รันคำสั่ง และกระจาย Event. [4]
    *   `runtime/self-awareness`: ระบบรู้จักและอธิบาย DNA ของตัวเองได้. [4]
    *   `config-loader`: โหลด Business Rules และการตั้งค่าต่างๆ จากฐานข้อมูล. [4]
    *   `connector-loader`: จัดการ Dynamic Registry สำหรับการเชื่อมต่อภายนอก (Connectors). [18]

### 2. Gateway
*   **หน้าที่**: เป็นประตูเพียงบานเดียวสำหรับการเขียนข้อมูลที่ต้องมีการยืนยัน (Confirmed Writes) เช่น การชำระเงิน, การสร้างเอกสาร หรือการจัดการ Connectors. [2]
*   **หลักการสำคัญ**: ใช้รูปแบบ `preview → token → execute` เพื่อให้มนุษย์ยืนยันการกระทำที่มีความเสี่ยง (Rule 72). [12]
*   **โมดูลตัวอย่าง**:
    *   `gateway/actions`: จัดการ Action API สำหรับการ preview และ execute การกระทำต่างๆ. [4]
    *   `gateway/connectors`: เป็นส่วนที่เขียนข้อมูลของ Connector และบังคับใช้กฎของ Lifecycle. [18]

### 3. Registry
*   **หน้าที่**: เป็นศูนย์รวมทะเบียนของระบบ (Source of Truth for Runtime) ที่ทุกโมดูลต้องมาลงทะเบียนเพื่อให้ Core รู้จัก. [2]
*   **หลักการสำคัญ**: ระบบจะไม่มี "Shadow System" หรือโมดูลที่ไม่ได้ลงทะเบียน. [4] Registry แบ่งตามโดเมนต่างๆ เช่น `communication`, `execution`, `trace` และแต่ละโดเมนจะมี `_loader`, `_resolver`, `_schema`, `_validator` ของตัวเอง. [4]
*   **โมดูลตัวอย่าง**:
    *   `registry/modules`: ทะเบียนของทุกโมดูลในระบบ. [2]
    *   `registry/commands`: ทะเบียนของทุกคำสั่งที่ระบบรู้จัก. [2]
    *   `registry/database/*`: ทะเบียนสำหรับ Metadata Layer ที่เชื่อมระหว่างโค้ดกับฐานข้อมูล. [2]

### 4. Engines
*   **หน้าที่**: เป็นส่วนคำนวณ Business Logic ต่างๆ เช่น ราคา, ภาษี, ดอกเบี้ย, สถานะ, รวมถึงการตรวจสอบความถูกต้อง (Validation) และจัดการ Workflow ของเอกสารและธุรกรรม. [2]
*   **หลักการสำคัญ**: ห้าม hardcode ค่าทางธุรกิจ แต่ต้องดึงจาก `config-loader` เสมอ. [12]
*   **โมดูลตัวอย่าง**:
    *   `engines/pricing`: คำนวณราคาขายจาก ต้นทุน + markup. [4]
    *   `engines/debt/engine`: เครื่องยนต์หลักสำหรับจัดการหนี้ คำนวณสถานะ, ดอกเบี้ย, และยอดรวม. [4]
    *   `engines/partner/timeline`: สร้าง Timeline ของคู่ค้าโดยรวมเอกสารและ Business Events เข้าด้วยกัน. [4]
    *   `engines/connectors/tester`: ทำหน้าที่ทดสอบการเชื่อมต่อกับบริการภายนอกจริงๆ (Real network call). [18]

### 5. Plugins
*   **หน้าที่**: เป็นส่วนที่สามารถแตกขยายได้อย่างไม่จำกัด ใช้สำหรับเชื่อมต่อและควบคุมแอปพลิเคชันภายนอก (App Drivers) เช่น LINE, Chrome, VSCode หรือระบบอัตโนมัติบน macOS. [2]
*   **หลักการสำคัญ**: Plugin ห้ามเรียกใช้ Core หรือ Plugin อื่นโดยตรง แต่ต้องสื่อสารผ่าน Gateway ด้วย Event เท่านั้น (Law 2 & 3). [16]
*   **โมดูลตัวอย่าง**:
    *   `plugins/drivers/base`: Driver พื้นฐานสำหรับควบคุมแอปพลิเคชันบน macOS. [4]
    *   `plugins/drivers/line`: Driver สำหรับควบคุม LINE Desktop ผ่าน AppleScript. [4]
    *   `platform/mac`: Platform Layer สำหรับจัดการ Action ต่างๆ บน macOS เช่น การคลิก, พิมพ์, หรือเปิดแอป. [4]

### 6. Services
*   **หน้าที่**: เป็นขอบเขตของการทำ I/O (Input/Output) ทั้งหมด เช่น การเชื่อมต่อฐานข้อมูล (DB), Realtime, สะพานเชื่อมต่อ AI และ Middleware ต่างๆ. [2]
*   **หลักการสำคัญ**: Layer อื่นๆ (ยกเว้น Core และ Gateway บางส่วน) ห้าม import `@supabase/supabase-js` โดยตรง แต่ต้องเรียกผ่าน Services Layer. [12]
*   **โมดูลตัวอย่าง**:
    *   `services/supabase/queries`: เป็นที่เดียวสำหรับสร้าง Supabase client และฟังก์ชัน Query ทั้งหมด. [4]
    *   `services/ai/bridge-openai`: ใช้ GPT-4o-mini ในการแปลภาษาไทยเป็น JSON command. [4]
    *   `services/middleware/auth`: Middleware สำหรับตรวจสอบสิทธิ์ผู้ใช้ผ่าน Bearer token. [4]

## คำสั่งที่สำคัญสำหรับนักพัฒนา

โปรเจกต์มีชุดคำสั่งสำหรับตรวจสอบคุณภาพและสถานะของระบบ:

```bash
# ตรวจสอบทุกอย่างก่อน commit
npm run precommit

# ตรวจสอบความสอดคล้องของ Layer และ Type
npm run lint
npm run type-check

# หาโค้ดที่ไม่ได้ใช้งาน หรือโค้ดที่ซ้ำซ้อน
npm run dead-code
npm run duplicates

# รัน Script สำหรับตรวจสอบ Governance ของสถาปัตยกรรม
npm run guard

# ซิงค์ Registry และสร้างเอกสารสถาปัตยกรรม
npm run sync
```

สำหรับรายการคำสั่งทั้งหมด สามารถดูได้ที่ไฟล์ `package.json`. [3]