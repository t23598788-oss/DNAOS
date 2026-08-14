# permissions/execution-policy/ — NOT_YET_BUILT

**หน้าที่:** สิทธิ์การ Run/Test/Deploy — ใครมีสิทธิ์สั่งให้ Software ตัวไหน
รัน/ทดสอบ/deploy ได้บ้าง แยกจาก `../access-control/` (ซึ่งตอบแค่ "identity
นี้คือใคร ผูกกับ account ไหน") และแยกจาก `../software-scope/` (ซึ่งตอบว่า
account ไหนถือ software ตัวไหน) — ไฟล์นี้ตอบคำถามที่สามคือ "ถือ software
แล้ว มีสิทธิ์สั่ง execution จริงแค่ไหน"

**Input:** ยังไม่กำหนด — ต้องรอ `../../execution/` มี executor จริงก่อน
จึงจะรู้ว่า policy ต้องตรวจอะไรบ้าง

**Output:** ยังไม่มี

**Dependency ที่อนุญาต:** `../access-control/`, `../software-scope/`
(เมื่อสร้างจริง)

**สิ่งที่ห้ามแตะ:** ห้ามให้ policy นี้กลายเป็นจุดเดียวที่ authorize ทั้งระบบ
— ยังต้องผ่าน access-control ก่อนเสมอ (this ต่อยอด ไม่ทดแทน)

ไม่มีไฟล์ source ในโฟลเดอร์นี้ — ยังไม่มี use case จริงให้ออกแบบ policy
ตาม (Owner instruction: ห้ามสร้างข้อมูลจำลองเพื่อเติมโครง)
