# จุดเชื่อมหลังบ้าน

ข้อกำหนดต่อไปนี้ไม่ใช่ API ที่ยืนยันว่ามีครบ ต้องเทียบ source ปัจจุบันก่อนเชื่อม

| ส่วน | ข้อมูลเข้า | การทำงานและผล |
|---|---|---|
| Workspace | session, permissions, capabilities, messages | ส่งคำสั่ง แนบไฟล์ เปิดผล พร้อม pending/running/success/error |
| Notifications | authorized connector events | unread count จากข้อมูลจริง เปิดและอ่านรายการ |
| Settings | registry, connections, device state | บันทึกผ่าน authority เดิมและแสดงผลจริง |
| A4 | document ID, dates, issuer, customer, items, canonical totals | preview/export/print; ไม่คำนวณยอดใหม่ใน UI |
| Assistants | authorized task state, summaries, schedules | map ready/idle/busy/notification/completed จาก event จริง |

- UI ไม่ถือ service-role หรือ provider secrets และ server ต้องตรวจสิทธิ์ทุกคำสั่ง
- ข้อมูลลงเอกสารต้อง escape ไม่ใช้ innerHTML จากข้อความที่ไม่เชื่อถือ
- เอกสารหลายรายการต้องทำ pagination A4 ไม่ตัดข้อมูลทิ้งตามความสูงของ demo
- PDF ต้องเก็บตัวอักษรเป็นข้อความและฝังฟอนต์ที่อนุญาต ไม่ใช้ภาพหน้าจอแทนเอกสาร
- ผู้ช่วยเป็นภาพแสดงสถานะ ไม่ใช่ agent executor; animation จบไม่เท่ากับงานสำเร็จ
- พูดเฉพาะ opt-in เคารพ reduced motion ไม่เปิดไมค์/กล้องเอง
- คง sandbox/CSP ของไฟล์อ้างอิง; component จริงต้องกำหนด trust boundary ที่เหมาะสม
- งานที่ยังต่อไม่ได้ต้องแจ้ง unavailable ไม่แสดง demo เป็นผลจริง

## จุดเริ่มค้น source เดิม
app/workspace/, app/admin/relationships/, core/workspace/, registry/,
engines/, device-connector/, src-tauri/, presentation/assets/
ไม่แนบ backend snapshot เพื่อไม่ทับงานล่าสุดของนักพัฒนา

## เกณฑ์ตรวจ
login → UI ตามสิทธิ์ → capability จริง → evidence/result จริง
เอกสารยอดตรง canonical source และพิมพ์ไม่ล้น
ผู้ช่วยตรงสถานะงานจริง ไม่มีข้อมูลข้ามบัญชี
รายงานรายการที่ยังไม่ได้เชื่อมและทดสอบ ไม่ประกาศพร้อมจาก build อย่างเดียว
