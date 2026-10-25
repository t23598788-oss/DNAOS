/**
 * Canonical generated-artifact write model (Phase D7).
 *
 * Only files the SYSTEM generates live here: document_version → document_artifact
 * → storage object → sha256/size/mime → audit. Original inbound files never enter
 * this table (their owner is `receipt_documents.media_path` — v1.1 invariant 7).
 *
 * Transaction safety: the storage upload happens first; if the DB write then fails
 * the uploaded object is removed and the failure is recorded, so a half state
 * (file without a row, or a row without a file) is not left behind silently.
 */
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/services/supabase/queries";
import { recordCanonicalAudit } from "@/engines/canonical/audit";

const BUCKET = "attachments";

export interface PersistArtifactInput {
  document_version_id: string;
  kind: "pdf" | "image";
  fileName: string;
  bytes: Uint8Array;
  mime_type: string;
  produced_by: string;
  actor: string;
  storage_path?: string;
  /**
   * When true the object is already in storage at `storage_path` (uploaded by the
   * caller) — only metadata + audit are written, so there is exactly one file per
   * artifact. Rollback then belongs to the caller's flow.
   */
  already_uploaded?: boolean;
}

export interface PersistArtifactResult {
  artifact_id: string;
  storage_path: string;
  sha256: string;
  size_bytes: number;
  mime_type: string;
}

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

export async function persistGeneratedArtifact(input: PersistArtifactInput): Promise<PersistArtifactResult> {
  const db = supabaseAdmin();
  const { data: version } = await db.from("document_versions").select("id").eq("id", input.document_version_id).maybeSingle();
  if (!version) throw new Error("ARTIFACT_VERSION_REQUIRED: ต้องมี document_version ก่อนบันทึกไฟล์ที่ระบบสร้าง");

  const sha256 = sha256Of(input.bytes);
  const size = input.bytes.byteLength;
  const path = input.storage_path ?? `generated-documents/${input.document_version_id}/${Date.now()}/${input.fileName}`;
  const storage = db.storage.from(BUCKET);

  if (!input.already_uploaded) {
    const upload = await storage.upload(path, input.bytes, { contentType: input.mime_type, upsert: false });
    if (upload.error) {
      await recordCanonicalAudit({
        action: "artifact.failed",
        entity_type: "document_version",
        entity_id: input.document_version_id,
        actor: input.actor,
        new_value: { stage: "upload", path, error: upload.error.message },
      });
      throw new Error(`อัปโหลดไฟล์ที่ระบบสร้างไม่สำเร็จ: ${upload.error.message}`);
    }
  } else if (!input.storage_path) {
    throw new Error("ARTIFACT_PATH_REQUIRED: already_uploaded=true ต้องระบุ storage_path ที่มีอยู่จริง");
  }

  const { data, error } = await db
    .from("document_artifacts")
    .insert({
      document_version_id: input.document_version_id,
      kind: input.kind,
      storage_bucket: BUCKET,
      storage_path: path,
      sha256,
      size_bytes: size,
      mime_type: input.mime_type,
      produced_by: input.produced_by,
      created_by: input.actor,
    })
    .select("id")
    .single();

  if (error) {
    // rollback the orphan object so the storage and the DB never disagree
    const removed = input.already_uploaded ? { error: undefined } : await storage.remove([path]);
    await recordCanonicalAudit({
      action: "artifact.failed",
      entity_type: "document_version",
      entity_id: input.document_version_id,
      actor: input.actor,
      new_value: { stage: "db_insert", path, error: error.message, rolled_back: !removed.error },
    });
    throw new Error(`บันทึก metadata ของไฟล์ไม่สำเร็จ (rollback storage แล้ว): ${error.message}`);
  }

  await recordCanonicalAudit({
    action: "artifact.created",
    entity_type: "document_artifact",
    entity_id: String(data.id),
    actor: input.actor,
    new_value: { kind: input.kind, path, sha256, size_bytes: size, mime_type: input.mime_type },
    evidence: { document_version_id: input.document_version_id, produced_by: input.produced_by },
  });

  return { artifact_id: String(data.id), storage_path: path, sha256, size_bytes: size, mime_type: input.mime_type };
}

/** Signed URL for a stored artifact — proves the generated file really opens. */
export async function signedArtifactUrl(storagePath: string, ttlSeconds = 60 * 60) {
  const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUrl(storagePath, ttlSeconds);
  if (error || !data?.signedUrl) throw new Error(`สร้างลิงก์ไฟล์ที่ระบบสร้างไม่สำเร็จ: ${error?.message ?? "ไม่มี URL"}`);
  return data.signedUrl;
}
