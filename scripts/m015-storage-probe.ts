// M015 Stage 5 — Storage contract probe (final, assertion-free).
// Goal: exercise the REAL storage surface the true-platform branch uses
// (engines/canonical/artifact-write.ts + app/admin upload/download routes)
// against the isolated shim, through the same supabase-js version
// (@supabase/supabase-js 2.x). Every step logs M015_STORAGE_RESULT {...}.
//
// NO new engine, NO business-logic changes: this script only CALLS the
// canonical writer path and reports what it observed.
process.env.TS_NODE_DEV = process.env.TS_NODE_DEV ?? "";

function out(step: string, payload: Record<string, unknown>) {
  console.log(`M015_STORAGE_RESULT ${JSON.stringify({ step, ...payload })}`);
}

function bytesOf(reps: number): Uint8Array {
  const s = Buffer.from("%PDF-1.4\n% M015 synthetic artifact — isolated acceptance only\n");
  const buf = Buffer.alloc(s.length * reps);
  for (let i = 0; i < reps; i++) s.copy(buf, i * s.length);
  return new Uint8Array(buf);
}

async function head(url: string, method: string, body: Buffer | undefined, extraHeaders: Record<string, string>) {
  const res = await fetch(url, { method, body, headers: extraHeaders });
  const text = await res.text();
  const sentAuth = Boolean(extraHeaders["Authorization"] || extraHeaders["apikey"]);
  return { status: res.status, body: text.slice(0, 200), sentAuth };
}

async function main() {
  const dbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_SERVICE_URL;
  if (!dbUrl) {
    console.log('M015_STORAGE_RESULT {"step":"env","supabaseUrlMissing":true,"url":"' + (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '') + '"}');
    process.exit(2);
  }
  const { supabaseAdmin } = await import("@/services/supabase/queries");
  await import("@supabase/supabase-js"); // same client version pinned by repo
  const { persistGeneratedArtifact, sha256Of } = await import("@/engines/canonical/artifact-write");
  const db = supabaseAdmin();
  const storage = supabaseAdmin().storage.from("attachments");

  // ── pick an existing document_version (fixture already in DB; read-only use) ──
  const { data: versions, error: verErr } = await db
    .from("document_versions")
    .select("id")
    .limit(1);
  if (verErr || !versions?.length) {
    out("fixture", { ok: false, error: "NO_DOCUMENT_VERSION: need one document_versions row (seeded fixture)" });
    process.exit(2);
  }
  const versionId = String(versions[0].id);
  const stamp = Date.now();
  const path = `m015-probe/${versionId}/${stamp}/probe.pdf`;

  // ── U1: real upload path of artifact-write.ts (storage.upload) ──
  const bytes = bytesOf(40);
  const expectedSha = sha256Of(bytes);
  const upload = await storage.upload(path, bytes, { contentType: "application/pdf", upsert: false });
  out("U1_upload", {
    ok: !upload.error,
    data: upload.data,
    error: upload.error?.message ?? null,
    bytes: bytes.byteLength,
  });

  // ── U2: duplicate upload must be refused by real storage (already exists) ──
  const dup = await storage.upload(path, bytes, { contentType: "application/pdf", upsert: false });
  out("U2_duplicate_upload_no_upsert", { ok: !dup.error, error: dup.error?.message ?? null, data: dup.data });

  // ── S1: createSignedUrl — the exact call artifact-write.signedArtifactUrl uses ──
  const signed = await storage.createSignedUrl(path, 3600);
  out("S1_createSignedUrl", {
    ok: !signed.error,
    data: signed.data,
    error: signed.error?.message ?? null,
  });

  // ── S2: createSignedUploadUrl — used by signed upload flows elsewhere in repo ──
  let s2: unknown = null;
  try {
    s2 = await storage.createSignedUploadUrl(`m015-probe/${stamp}/up-sign.pdf`);
  } catch (e) {
    s2 = { threw: e instanceof Error ? e.message : String(e) };
  }
  out("S2_createSignedUploadUrl", { result: s2 });

  // ── D1: download — real retrieval (webhook handlers + admin routes use this) ──
  const dl = await storage.download(path);
  out("D1_download", {
    ok: !dl.error,
    bytes: dl.data?.byteLength ?? 0,
    error: dl.error?.message ?? null,
  });

  // ── SCOPE: the shim must not accept anonymous writes if it wants to claim
  //    Supabase Storage parity — real storage requires apikey/jwt context. ──
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const scopeAnon = await head(`${base}/storage/v1/object/attachments/${path}`, "POST", Buffer.from(" AnonymousWriteProbe "), {});
  out("SCOPE1_upload_no_auth", { ...scopeAnon });
  const scopeUserJwt = await head(`${base}/storage/v1/object/attachments/${path}`, "POST", Buffer.from(" FakeUserJwt "), {
    Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.fake",
    apikey: "fake-user-key",
  });
  out("SCOPE2_upload_fake_user_jwt", { ...scopeUserJwt });

  // ── CANON: the true-platform canonical writer, unmodified ──
  const canon = await persistGeneratedArtifact({
    document_version_id: versionId,
    kind: "pdf",
    fileName: "m015-probe.pdf",
    bytes,
    mime_type: "application/pdf",
    produced_by: "m015-storage-probe",
    actor: "m015-storage-probe",
  });
  out("C1_persistGeneratedArtifact", {
    ok: true,
    artifact_id: canon.artifact_id,
    storage_path: canon.storage_path,
    sha256: canon.sha256,
    sha256_matches_compute: canon.sha256 === expectedSha,
    size_bytes: canon.size_bytes,
    size_matches: canon.size_bytes === bytes.byteLength,
    mime_type: canon.mime_type,
  });
  const samePathReupload = await storage.upload(path, bytes, { contentType: "application/pdf", upsert: false });
  out("C2_canonical_path_object_exists", { ok: !samePathReupload.error, error: samePathReupload.error?.message ?? null });

  // ── ROLLBACK: kind violates DB CHECK → insert fails AFTER upload → writer
  //    must remove the orphan object (shim DELETE) and record artifact.failed ──
  const rbPath = `m015-probe/${versionId}/${stamp}/rollback.pdf`;
  const rbBytes = bytesOf(21);
  let rbError: string | null = null;
  let rbAudits: Record<string, unknown>[] = [];
  try {
    await persistGeneratedArtifact({
      document_version_id: versionId,
      kind: "bogus" as unknown as "pdf",
      fileName: "rollback.pdf",
      bytes: rbBytes,
      mime_type: "application/pdf",
      produced_by: "m015-storage-probe",
      actor: "m015-storage-probe",
      storage_path: rbPath,
    });
    out("R1_rollback_case", { ok: false, error: "unexpected success — check constraint not hit" });
  } catch (e) {
    rbError = e instanceof Error ? e.message : String(e);
  }
  const rbAudit = await supabaseAdmin()
    .from("audit_logs")
    .select("id, action, entity_type, new_value")
    .gte("created_at", new Date(Date.now() - 120000).toISOString())
    .eq("entity_type", "document_version")
    .order("created_at", { ascending: false })
    .limit(5);
  rbAudits = (rbAudit.data ?? []) as unknown as Record<string, unknown>[];
  const failedAudit = rbAudits.find((a) => a["action"] === "artifact.failed");
  const createdAudit = rbAudits.find((a) => a["action"] === "artifact.created");
  out("R1_rollback_case", {
    error: rbError,
    contains_rollback_note: rbError?.includes("rollback") ?? false,
    failed_audit_found: Boolean(failedAudit),
    failed_audit: failedAudit ?? null,
  });

  // ── E: audit chain for the successful artifact ──
  const createdOk = await supabaseAdmin()
    .from("audit_logs")
    .select("id, action, entity_id, new_value")
    .eq("action", "artifact.created")
    .order("created_at", { ascending: false })
    .limit(3);
  const createdRow = (createdOk.data ?? []).find((a) => a["entity_id"] === canon.artifact_id);
  out("E1_audit_chain", {
    artifact_created_audit_found: Boolean(createdRow),
    created_audit: createdRow ?? null,
  });

  // ── CLEANUP: remove both probe objects (synthetic, isolated env only) ──
  const rm = await storage.remove([path, rbPath]);
  out("Z1_remove", { ok: !rm.error, data: rm.data, error: rm.error?.message ?? null });
  const artifactsAfter = await supabaseAdmin()
    .from("document_artifacts")
    .select("id")
    .eq("storage_path", path);
  out("Z2_artifact_row_kept_after_remove", {
    row_count: (artifactsAfter.data ?? []).length,
  });
}

void main();
