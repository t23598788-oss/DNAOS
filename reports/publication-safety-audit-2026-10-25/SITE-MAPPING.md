# STEP 06 — เว็บไซต์ต้นฉบับ + Mapping (ไม่รวมโค้ด, ไม่เปลี่ยนดีไซน์)

**ต้นฉบับ:** `/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/`
**สถานะรอบนี้:** ตรวจ + จัดทำ mapping เท่านั้น — ไม่คัดลอกโค้ดเข้า repo นี้ ไม่แก้หน้า Production

## 1. ความครบถ้วนของไฟล์

| ไฟล์ | ขนาด | SHA-256 |
|---|---|---|
| `app/landing/DnaLanding.tsx` | 34,335 B | `3cc178d98355fb0cafe1b57763cc8e8e9e8d0de469a4267bf8c8f7cd06d8104e` |
| `app/landing/SystemOverview.tsx` | 16,963 B | `f987b90d32ca3c2617bd24260c15f6769008f56e0342e64f7ea9867cea17dd22` |
| `app/landing/LiveArchitectureDiagram.tsx` | 8,431 B | `6ec3fac23dfe1ef988e26bb6aeb4d8bfdbcd47610783b1eadd903b3e592027be` |
| `public/landing/scene-01-quarry.jpg` (Hero เหมือง) | 612,373 B | `ffb8ac925057dee7f80f153fa47475128438493bcce687b6d11252b654948281` |
| `public/landing/scene-02-manufacturing-clean.jpg` (ภาพโรงงาน) | 355,203 B | `3a1896b5c046d6cc695c7fdec22d1e4f0645a0e398b7451d5abc6ea3d46397c2` |

Hero = ฉาก 01 ของ `DnaLanding.tsx` (`scene-01-quarry.jpg`, บรรทัด 42–50) · ภาพโรงงาน = ฉาก 02 (`scene-02-manufacturing-clean.jpg`, บรรทัด 54–63) · component ต้นฉบับทั้ง 3 ไฟล์อยู่ครบ

## 2. Mapping (ข้อเสนอ — ยังไม่รวมโค้ด)

| ส่วนของเว็บเดิม | ตาราง/ฟิลด์ที่มีอยู่แล้ว | ช่องค้นหาสาธารณะ |
|---|---|---|
| ฉาก 01 “ทรัพยากรและการผลิต” (Hero เหมือง) `DnaLanding.tsx:42–50` | `pit_profiles` (`pit_name`, `formatted_address`, `is_open`) · `material_types.name` · `pit_materials.price` | **ไม่มีในต้นฉบับ** — ต้องใช้ช่องค้นหาของ `/products/catalog` ที่มีอยู่ (`type`, `q`, `province`, `district`, `area`) โดยไม่สร้างชุดใหม่ |
| ฉาก 02 “โรงงาน” `DnaLanding.tsx:54–63` + บอร์ดการเงิน `SystemOverview.tsx:56–87` | เอกสาร/การเงินภายใน (ไม่ใช่ข้อมูลสาธารณะ) | ไม่ใช้ |
| ฉาก 03 “บริการเซิร์ฟเวอร์” `SystemOverview.tsx:101–114` | system control graph (DEMO) | ไม่ใช้ |
| ฉาก 04 “ภาพรวมการเชื่อมโยง” `LiveArchitectureDiagram.tsx` | แผนผัง HTML ต้นฉบับ (`/diagrams/dna-os-architecture.html`) | ค้นหาโหนดในผัง (ไม่ใช่ค้นหาสินค้า) |
| `app/products/page.tsx` (ต้นฉบับ) | เป็น directory ของ portal (`registry/portals.json`) ไม่ใช่แคตตาล็อก | ไม่มี |

## 3. ข้อสรุปที่ต้องตัดสินใจก่อนรวมโค้ด

1. ต้นฉบับ **ไม่มี** หน้าแคตตาล็อกหรือช่องค้นหาสาธารณะ → ไม่มี “ช่องค้นหาเดิม” ให้ map ตรง ๆ
2. ทางเลือกที่ไม่เปลี่ยนดีไซน์: ใช้ CTA ของฉาก 01 ชี้ไป `/products/catalog` (หน้าที่มีอยู่แล้วใน repo นี้) แทนการฝังตารางในหน้าแรก
3. ถ้าต้องการแสดงรายการบนหน้าแรกจริง ต้องออกแบบส่วนใหม่ = เกินขอบเขต “ไม่เปลี่ยนดีไซน์” ของรอบนี้ → ต้องมีใบสั่งงานแยก
4. ข้อจำกัดข้อมูลที่ต้องคงไว้: ห้ามแสดง `phone`, `address` ดิบ, `latitude/longitude` (ยกเว้น whitelist `coordinates`), `bank_*`, `taxpayer_id` — ใช้ `toPublicView()` เท่านั้น
