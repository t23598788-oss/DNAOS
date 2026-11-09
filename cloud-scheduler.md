# แทน cron ของ Vercel ด้วย Cloud Scheduler

`vercel.json` มี cron 2 ตัวที่ Cloud Run ไม่มีให้อัตโนมัติ:

| endpoint | ความถี่ |
|---|---|
| `/api/cron/supabase-project-status` | ทุก 6 ชั่วโมง |
| `/api/cron/operations-loop` | ทุก 10 นาที |

## สร้าง Cloud Scheduler jobs

```bash
# แก้ SERVICE_URL, CRON_SECRET ก่อนรัน
SERVICE_URL="https://<cloud-run-url>"
CRON_SECRET="<secret>"
PROJECT="<gcp-project-id>"
REGION="asia-southeast1"

gcloud scheduler jobs create http supabase-project-status \
  --project "$PROJECT" \
  --location "$REGION" \
  --schedule "0 */6 * * *" \
  --uri "${SERVICE_URL}/api/cron/supabase-project-status" \
  --http-method GET \
  --headers "Authorization=Bearer ${CRON_SECRET}" \
  --attempt-deadline 300s

gcloud scheduler jobs create http operations-loop \
  --project "$PROJECT" \
  --location "$REGION" \
  --schedule "*/10 * * * *" \
  --uri "${SERVICE_URL}/api/cron/operations-loop" \
  --http-method GET \
  --headers "Authorization=Bearer ${CRON_SECRET}" \
  --attempt-deadline 300s
```

เปิด API ก่อน (ถ้ายังไม่เคยใช้):

```bash
gcloud services enable cloudscheduler.googleapis.com --project "$PROJECT"
```

## ข้อกำหนดที่ยืนยันจากโค้ดจริง (ไม่ใช่การเดา)

- ทั้งสอง route เป็น `GET` (`app/api/cron/*/route.ts` export `GET`)
- ตัวตรวจ auth เทียบทั้งสตริง: `auth !== \`Bearer ${cronSecret}\`` (`operations-loop/route.ts:24-26`,
  `supabase-project-status/route.ts:25-27`) ⇒ header ต้องเป็น `Authorization: Bearer <CRON_SECRET>`
  ตรงตัวเป๊ะ ไม่มี prefix/spacing อื่น
- ต้องตั้ง `CRON_SECRET` บน Cloud Run service ด้วย ไม่งั้นได้ `401 {"error":"unauthorized"}`
  ทุกครั้ง (ควรเก็บใน Secret Manager แล้วใช้ `--set-secrets CRON_SECRET=...`)
- schedule ของ Cloud Scheduler ตีความเป็น UTC โดยค่าเริ่มต้น
- `/api/cron/operations-loop` รัน loop ภายใต้ ownerId `system-cron` (sentinel ที่ route กำหนดไว้เอง)
  ไม่ใช่ session ของ admin คนจริง

## ตรวจว่า job ทำงาน

```bash
gcloud scheduler jobs list --project "$PROJECT" --location "$REGION"
gcloud run services logs tail <service> --region "$REGION"
```

## คำเตือน: อย่าให้ cron รันสอง platform พร้อมกัน

ถ้า Vercel ยังเปิด cron ของ repo นี้อยู่ **และ** Cloud Scheduler ชี้ไป Cloud Run ที่ใช้ Supabase
project เดียวกัน (`xeytcavxejhyzxwevgto`) endpoint จะถูกยิงซ้ำจากสองที่ — `/api/cron/operations-loop`
จะรัน loop ซ้อนกัน เขียนข้อมูลชุดเดียวกัน ต้องปิดฝั่งใดฝั่งหนึ่งก่อนเปิดอีกฝั่ง:

- ปิดฝั่ง Vercel: ลบ `crons` ใน `vercel.json` (หรือปิด project) — เป็นการแก้ repo
- หรือชี้ Cloud Run ไปอีก Supabase project สำหรับทดสอบ
