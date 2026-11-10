#!/usr/bin/env bash
# deploy-full.sh — build → deploy Cloud Run → Cloud Scheduler, with guards.
#
# หลักการ: ไม่เดาค่า ไม่สร้าง resource ถ้า input ยังไม่ถูกต้อง
#   ./deploy-full.sh            # รันจริง
#   ./deploy-full.sh --dry-run  # พิมพ์ทุกคำสั่งที่จะรัน แต่ไม่รันอะไรเลย
#
# ค่าที่ต้องมี (ส่งผ่าน env):
#   GCP_PROJECT_ID  GCP_REGION(optional)  SERVICE_NAME(optional)
#   SB_URL  SB_ANON  SB_SERVICE_ROLE  CRON_SECRET
#   GA_ID(optional)  LINE_URL(optional)  SUPABASE_MGMT_TOKEN(optional)
#   CONFIRM_DEPLOY=yes   (ต้องใส่เมื่อรันจริง)
#
# สิ่งที่ตั้งใจไม่ทำ: ไม่ปิด cron ฝั่ง Vercel ให้ (ทำด้วยมือ) และไม่ลบ resource ใด ๆ

set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "ไม่รู้จัก flag: $arg"; exit 2 ;;
  esac
done

GCP_PROJECT_ID="${GCP_PROJECT_ID:-}"
GCP_REGION="${GCP_REGION:-asia-southeast1}"
SERVICE_NAME="${SERVICE_NAME:-dna-runtime}"
BRANCH_TO_DEPLOY="${BRANCH_TO_DEPLOY:-chore/gcp-deploy-prep}"

GA_ID="${GA_ID:-}"
LINE_URL="${LINE_URL:-}"
SB_URL="${SB_URL:-}"
SB_ANON="${SB_ANON:-}"
SB_SERVICE_ROLE="${SB_SERVICE_ROLE:-}"
CRON_SECRET="${CRON_SECRET:-}"
SUPABASE_MGMT_TOKEN="${SUPABASE_MGMT_TOKEN:-}"

CONFIRM_DEPLOY="${CONFIRM_DEPLOY:-no}"

err()  { echo "STOP: $*" >&2; exit 1; }
warn() { echo "WARN: $*" >&2; }
note() { echo "[dry-run] $*"; }

# รันคำสั่ง (หรือแค่พิมพ์ ถ้า dry-run)
run() {
  if [ "$DRY_RUN" = "1" ]; then
    note "$(printf '%q ' "$@")"
    return 0
  fi
  "$@"
}

# รับค่าจาก stdin สำหรับ secret (ไม่ให้ค่าโผล่ใน process list / log)
run_stdin() {
  local stdin_value="$1"; shift
  if [ "$DRY_RUN" = "1" ]; then
    note "$(printf '%q ' "$@") <<< [secret hidden]"
    return 0
  fi
  printf '%s' "$stdin_value" | "$@"
}

echo "############################################################"
if [ "$DRY_RUN" = "1" ]; then
  echo "# DRY-RUN: จะพิมพ์คำสั่งเท่านั้น ไม่เรียก gcloud / ไม่แตะ cloud  #"
else
  echo "# DEPLOY: build → Cloud Run → Cloud Scheduler                 #"
fi
echo "############################################################"
echo ""

# ---------------------------------------------------------------- ขั้น 0: guards
echo "===== ขั้น 0: guards ====="

[ -n "$GCP_PROJECT_ID" ] || err "ไม่มี GCP_PROJECT_ID"
[ -n "$SB_URL" ]         || err "ไม่มี SB_URL"
[ -n "$SB_ANON" ]        || err "ไม่มี SB_ANON"
[ -n "$SB_SERVICE_ROLE" ]|| err "ไม่มี SB_SERVICE_ROLE (SUPABASE_SERVICE_ROLE_KEY)"
[ -n "$CRON_SECRET" ]    || err "ไม่มี CRON_SECRET — สร้างครั้งเดียวแล้วเก็บไว้ อย่าให้สคริปต์สุ่มเอง"

if [ "$DRY_RUN" != "1" ] && [ "$CONFIRM_DEPLOY" != "yes" ]; then
  err "ยังไม่ได้รับอนุมัติ deploy (ต้องใส่ CONFIRM_DEPLOY=yes)"
fi

# project id ต้องมีจริง
if [ "$DRY_RUN" = "1" ]; then
  note "gcloud projects describe $GCP_PROJECT_ID --format=value(projectId)"
else
  gcloud projects describe "$GCP_PROJECT_ID" --format="value(projectId)" >/dev/null 2>&1 \
    || err "project '$GCP_PROJECT_ID' ไม่มีจริง หรือบัญชีนี้ไม่มีสิทธิ์เข้าถึง"
fi

# branch: hard-fail ไม่ใช่ || true
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$CURRENT_BRANCH" = "$BRANCH_TO_DEPLOY" ] \
  || err "อยู่ branch $CURRENT_BRANCH แต่ต้องเป็น $BRANCH_TO_DEPLOY (สลับเองก่อน)"
[ -z "$(git status --porcelain)" ] || { git status -sb; err "มีไฟล์ค้าง — commit/stash ก่อน"; }
for f in Dockerfile cloudbuild.yaml; do
  [ -f "$f" ] || err "ไม่พบ $f ใน branch นี้"
done

# GA_ID: ต้องผ่าน regex เดียวกับแอป (app/layout.tsx) และต้องไม่ใช่ค่าซ้ำตัวอักษรเดียว
if [ -n "$GA_ID" ]; then
  [[ "$GA_ID" =~ ^G-[A-Za-z0-9]{4,}$ ]] || err "GA_ID '$GA_ID' ไม่ผ่านรูปแบบ G-XXXXXXXX"
  ga_suffix="${GA_ID#G-}"
  [[ "$ga_suffix" =~ ^(.)\1+$ ]] && err "GA_ID '$GA_ID' เป็นตัวอักษรซ้ำ (placeholder) — ไม่ deploy ค่าเทียม"
fi

# LINE_URL: ถ้าใส่ ต้องเป็น URL จริง
if [ -n "$LINE_URL" ]; then
  [[ "$LINE_URL" =~ ^https:// ]] || err "LINE_URL ต้องขึ้นต้นด้วย https://"
  case "$LINE_URL" in
    *yourOA*|*@your*|*example*) err "LINE_URL ยังเป็น placeholder: $LINE_URL" ;;
  esac
fi

# SB_URL: ต้องเป็น *.supabase.co
[[ "$SB_URL" =~ ^https://[a-z0-9-]+\.supabase\.co/?$ ]] || err "SB_URL ไม่ใช่รูปแบบ https://<ref>.supabase.co"

# JWT: ตรวจ 3 ส่วน + อ่าน role จาก payload (ไม่พิมพ์ค่าออกมา)
jwt_role() {
  node -e '
    const v = process.argv[1] || "";
    const p = v.split(".");
    if (p.length !== 3) { console.log("__BAD__"); process.exit(0); }
    try {
      const json = Buffer.from(p[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      console.log(JSON.parse(json).role || "");
    } catch { console.log("__BAD__"); }
  ' "$1"
}

sb_anon_role=$(jwt_role "$SB_ANON")
[ "$sb_anon_role" = "anon" ] || err "SB_ANON ไม่ใช่ JWT ที่มี role=anon (ได้: ${sb_anon_role:-ว่าง})"

sb_service_role=$(jwt_role "$SB_SERVICE_ROLE")
[ "$sb_service_role" = "service_role" ] \
  || err "SB_SERVICE_ROLE ไม่ใช่ JWT ที่มี role=service_role (ได้: ${sb_service_role:-ว่าง})"

[ "${#CRON_SECRET}" -ge 32 ] || err "CRON_SECRET สั้นเกินไป (ต้อง >= 32 ตัวอักษร)"

echo "OK: project=$GCP_PROJECT_ID region=$GCP_REGION service=$SERVICE_NAME"
echo "OK: branch=$CURRENT_BRANCH commit=$(git rev-parse --short HEAD)"
echo "OK: GA_ID=$([ -n "$GA_ID" ] && echo "ตั้งค่าแล้ว" || echo "ว่าง (ไม่ฉีด gtag)")"
echo "OK: secrets ผ่านการตรวจรูปแบบ (anon / service_role / cron)"
if [ -z "$SUPABASE_MGMT_TOKEN" ]; then
  warn "ไม่มี SUPABASE_MGMT_TOKEN → จะข้าม job supabase-project-status"
  warn "  (route นั้น return 500 ถ้าไม่มี token — สร้าง job ไปก็ได้แต่ยิงแล้วพัง)"
fi
echo ""

# ------------------------------------------- ขั้น 1: project + API + repo
echo "===== ขั้น 1: ตั้ง project + เปิด API ====="
run gcloud config set project "$GCP_PROJECT_ID"
run gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com secretmanager.googleapis.com

echo ""
echo "===== ขั้น 2: Artifact Registry repo ====="
if [ "$DRY_RUN" = "1" ]; then
  note "gcloud artifacts repositories describe cloud-run-source-deploy --location=$GCP_REGION (ถ้าไม่มี → create)"
else
  if ! gcloud artifacts repositories describe cloud-run-source-deploy \
        --location="$GCP_REGION" >/dev/null 2>&1; then
    gcloud artifacts repositories create cloud-run-source-deploy \
      --repository-format=docker --location="$GCP_REGION" \
      --description="Cloud Run images" \
      || err "สร้าง Artifact Registry repo ไม่สำเร็จ (อาจต้องรอ API propagate แล้วรันใหม่)"
  fi
fi
echo "OK: repo cloud-run-source-deploy ($GCP_REGION)"
echo ""

# ------------------------------------------------------- ขั้น 3: secrets
echo "===== ขั้น 3: เก็บ secrets (cron-secret, supabase-service-role) ====="

put_secret() { # $1=ชื่อ secret  $2=ค่า
  local name="$1" value="$2"
  if [ "$DRY_RUN" = "1" ]; then
    note "gcloud secrets create $name --data-file=- (ถ้ามีอยู่แล้ว → versions add)"
    return 0
  fi
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    run_stdin "$value" gcloud secrets versions add "$name" --data-file=- \
      || err "เพิ่ม version ของ secret '$name' ไม่สำเร็จ"
  else
    run_stdin "$value" gcloud secrets create "$name" --data-file=- \
      || err "สร้าง secret '$name' ไม่สำเร็จ (API ยังไม่ propagate? รอแล้วรันใหม่)"
  fi
  echo "OK: secret $name"
}

put_secret cron-secret "$CRON_SECRET"
put_secret supabase-service-role "$SB_SERVICE_ROLE"
echo ""

# ------------------------------- ขั้น 4: ให้ Cloud Run SA อ่าน secret ได้
echo "===== ขั้น 4: grant secretAccessor ให้ Cloud Run runtime SA ====="
if [ "$DRY_RUN" = "1" ]; then
  note "gcloud projects describe $GCP_PROJECT_ID --format=value(projectNumber) → <num>-compute@developer.gserviceaccount.com"
  note "gcloud secrets add-iam-policy-binding <secret> --member=serviceAccount:<sa> --role=roles/secretmanager.secretAccessor"
else
  PROJECT_NUMBER=$(gcloud projects describe "$GCP_PROJECT_ID" --format="value(projectNumber)")
  RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
  for s in cron-secret supabase-service-role; do
    gcloud secrets add-iam-policy-binding "$s" \
      --member="serviceAccount:${RUN_SA}" \
      --role="roles/secretmanager.secretAccessor" \
      --condition=None >/dev/null \
      || err "grant secretAccessor บน '$s' ไม่สำเร็จ"
  done
  echo "OK: $RUN_SA อ่าน secret ได้"
fi
echo ""

# --------------------------------------------------------- ขั้น 5: build
echo "===== ขั้น 5: build image (Cloud Build) ====="
run gcloud builds submit --config cloudbuild.yaml \
  --substitutions="_REGION=${GCP_REGION},_SERVICE=${SERVICE_NAME},_GA_ID=${GA_ID},_LINE_URL=${LINE_URL},_SB_URL=${SB_URL},_SB_ANON=${SB_ANON}"
echo ""

# -------------------------------------------------------- ขั้น 6: deploy
echo "===== ขั้น 6: deploy Cloud Run ====="
IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/cloud-run-source-deploy/${SERVICE_NAME}:latest"
run gcloud run deploy "$SERVICE_NAME" \
  --image="$IMAGE" \
  --region="$GCP_REGION" --platform=managed --allow-unauthenticated \
  --memory=1Gi --cpu=1 --timeout=300 --min-instances=0 --max-instances=3 \
  --set-env-vars="NEXT_PUBLIC_GA_ID=${GA_ID},NEXT_PUBLIC_LINE_OA_URL=${LINE_URL},NEXT_PUBLIC_SUPABASE_URL=${SB_URL},NEXT_PUBLIC_SUPABASE_ANON_KEY=${SB_ANON}" \
  --set-secrets="CRON_SECRET=cron-secret:latest,SUPABASE_SERVICE_ROLE_KEY=supabase-service-role:latest" \
  --quiet

if [ "$DRY_RUN" = "1" ]; then
  SERVICE_URL="https://<service-url-from-cloud-run>"
  note "gcloud run services describe $SERVICE_NAME --region=$GCP_REGION --format=value(status.url)"
else
  SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
    --region="$GCP_REGION" --format="value(status.url)")
fi
echo "URL: $SERVICE_URL"
echo ""

# --------------------------------------------------- ขั้น 7: health check
echo "===== ขั้น 7: health check (retry รอ cold start) ====="
if [ "$DRY_RUN" = "1" ]; then
  note "curl -fsS -o /dev/null -w %{http_code} $SERVICE_URL (retry 12 ครั้ง ห่าง 5s)"
  HTTP="200"
else
  HTTP="000"
  for _ in $(seq 12); do
    HTTP=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$SERVICE_URL" || echo "000")
    [ "$HTTP" -ge 200 ] && [ "$HTTP" -lt 400 ] && break
    sleep 5
  done
fi
echo "HTTP $HTTP"
if [ "$HTTP" -lt 200 ] || [ "$HTTP" -ge 400 ]; then
  err "service ไม่ตอบปกติ — หยุดก่อนตั้ง scheduler (ตรวจ log: gcloud run services logs read $SERVICE_NAME --region=$GCP_REGION)"
fi
echo ""

# ------------------------------------------------------ ขั้น 8: scheduler
echo "===== ขั้น 8: Cloud Scheduler ====="

create_or_update_job() { # $1=name $2=schedule $3=path
  local name="$1" schedule="$2" path="$3"
  if [ "$DRY_RUN" = "1" ]; then
    note "gcloud scheduler jobs create http $name --location=$GCP_REGION --schedule='$schedule' --uri=$SERVICE_URL$path --http-method=GET --headers='Authorization=Bearer [secret]' --attempt-deadline=300s (ถ้ามีอยู่แล้ว → update)"
    return 0
  fi
  if gcloud scheduler jobs describe "$name" --location="$GCP_REGION" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$name" \
      --location="$GCP_REGION" --schedule="$schedule" \
      --uri="${SERVICE_URL}${path}" --http-method=GET \
      --headers="Authorization=Bearer ${CRON_SECRET}" --attempt-deadline=300s \
      || err "update job '$name' ไม่สำเร็จ"
  else
    gcloud scheduler jobs create http "$name" \
      --location="$GCP_REGION" --schedule="$schedule" \
      --uri="${SERVICE_URL}${path}" --http-method=GET \
      --headers="Authorization=Bearer ${CRON_SECRET}" --attempt-deadline=300s \
      || err "create job '$name' ไม่สำเร็จ"
  fi
  echo "OK: job $name ($schedule)"
}

create_or_update_job operations-loop "*/10 * * * *" "/api/cron/operations-loop"

if [ -n "$SUPABASE_MGMT_TOKEN" ]; then
  put_secret supabase-management-token "$SUPABASE_MGMT_TOKEN"
  if [ "$DRY_RUN" != "1" ]; then
    PROJECT_NUMBER=$(gcloud projects describe "$GCP_PROJECT_ID" --format="value(projectNumber)")
    gcloud secrets add-iam-policy-binding supabase-management-token \
      --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
      --role="roles/secretmanager.secretAccessor" --condition=None >/dev/null \
      || err "grant secretAccessor บน supabase-management-token ไม่สำเร็จ"
    gcloud run services update "$SERVICE_NAME" --region="$GCP_REGION" \
      --update-secrets="SUPABASE_MANAGEMENT_API_TOKEN=supabase-management-token:latest" --quiet \
      || err "ผูก SUPABASE_MANAGEMENT_API_TOKEN เข้า service ไม่สำเร็จ"
  fi
  create_or_update_job supabase-project-status "0 */6 * * *" "/api/cron/supabase-project-status"
else
  warn "ข้าม job supabase-project-status (ไม่มี SUPABASE_MGMT_TOKEN — job จะได้ HTTP 500)"
fi
echo ""

# ------------------------------------------------ ขั้น 9: ยิงทดสอบจริง
echo "===== ขั้น 9: ทดสอบ scheduler ยิงจริง (operations-loop) ====="
if [ "$DRY_RUN" = "1" ]; then
  note "gcloud scheduler jobs run operations-loop --location=$GCP_REGION"
  note "curl -H 'Authorization: Bearer [secret]' $SERVICE_URL/api/cron/operations-loop → ต้องได้ 200"
  note "gcloud logging read 'resource.labels.service_name=\"$SERVICE_NAME\"' --limit=10"
else
  gcloud scheduler jobs run operations-loop --location="$GCP_REGION" || err "สั่ง run job ไม่สำเร็จ"
  sleep 20
  CRON_HTTP=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 60 \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    "${SERVICE_URL}/api/cron/operations-loop" || echo "000")
  echo "cron endpoint HTTP $CRON_HTTP"
  [ "$CRON_HTTP" = "200" ] || warn "cron endpoint ไม่ได้ 200 — ตรวจ log ก่อนปิด Vercel cron"
fi
echo ""

# ------------------------------------------------------------ สรุป
echo "===== เสร็จ ====="
echo "service : $SERVICE_NAME"
echo "URL     : $SERVICE_URL"
echo "region  : $GCP_REGION"
echo ""
echo "ยังต้องทำด้วยมือ (สคริปต์ไม่แตะ Vercel):"
echo "  1. ปิด/pause cron 2 job ใน Vercel Dashboard — หลังยืนยันว่า Cloud Scheduler ยิง 200"
echo "  2. เก็บ CRON_SECRET ไว้ที่ปลอดภัย (ใช้ซ้ำทั้ง Cloud Run และ Scheduler)"
echo ""
echo "log : gcloud run services logs read $SERVICE_NAME --region=$GCP_REGION"
echo "ลบ  : gcloud run services delete $SERVICE_NAME --region=$GCP_REGION"
