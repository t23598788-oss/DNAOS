# execution/test/ — NOT_YET_BUILT

**หน้าที่:** รัน test ของ Software ที่ลงทะเบียนไว้ — ผลลัพธ์เป็นเงื่อนไข
ก่อนเข้า `../deploy/` เสมอ

**Input:** `CommandEnvelope` ที่ classify แล้วว่า intent = test

**Output:** Test Result → บันทึกที่ `../../audit/code-change-audit/`

**Dependency ที่อนุญาต:** `../../contracts/command/`, `../build/`

**สิ่งที่ห้ามแตะ:** ห้าม deploy โดยข้าม test result ที่ fail

ไม่มีไฟล์ source ในโฟลเดอร์นี้
