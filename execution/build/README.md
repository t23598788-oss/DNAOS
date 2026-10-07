# execution/build/ — NOT_YET_BUILT

**หน้าที่:** Build source code ของ Software ที่ลงทะเบียนไว้ใน
`../../software/software-registry/`

**Input:** `CommandEnvelope` ที่ classify แล้วว่า intent = build

**Output:** ผล build → บันทึกที่ `../../audit/code-change-audit/`

**Dependency ที่อนุญาต:** `../../contracts/command/`,
`../../software/repository-registry/`

**สิ่งที่ห้ามแตะ:** ห้าม build โค้ดที่ไม่ผ่าน
`../../governance/source-validation/` ก่อน

ไม่มีไฟล์ source ในโฟลเดอร์นี้
