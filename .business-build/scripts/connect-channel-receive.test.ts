/**
 * CONNECT CHANNEL-RECEIVE GUARD (owner channel-expansion, 2026-10-07).
 *
 * Offline test (no DB, no production writes, no credentials) for the expanded
 * receive path: source channel → adapter verifies/translates → Connect central
 * (gateway observe / inbound bridge) → existing capabilities. Covers the six
 * owner-required scenarios:
 *   R1 receive data        — Meta page/instagram payloads normalize to canonical events
 *   R2 signature/auth fail — X-Hub-Signature-256 + hub.verify_token fail-closed
 *   R3 file/load fail      — inbound bridge transport failure returns ok:false (no fallback)
 *   R4 duplicate event     — deterministic event_id from provider message id (idempotent upsert)
 *   R5 retry               — observe route answers 500 on publish failure so the provider retries
 *   R6 central receive fail— missing env = ok:false WITHOUT any network attempt, no direct write
 * Plus the standing honesty rules:
 *   H1 LINE account audit  — payload.destination threaded into line_events.extracted.channel_destination
 *   H2 no direct local-runtime writes — watch-drive/backfill* create rows only via the Connect bridge
 *   H3 vocabulary not stretched — source_channel still exactly the original 5 values in CODE;
 *      facebook/instagram expansion lives ONLY in NOT-APPLIED draft migrations (proposal first)
 *   H4 TikTok is NOT claimed — no adapter/route/connector exists (official TikTok webhooks carry
 *      no message events; Business Messaging needs an approved app) and the catalog stays disabled
 *   H5 Meta document leg honestly NOT WIRED — no credential = no file download, so the observe
 *      route must not pretend to call the inbound bridge
 *   H6 no secrets in .env.local.example (empty values only)
 *
 * Negative controls (NC) prove the scanners catch what they claim.
 * File naming: `.test.ts` = sanctioned non-module pattern (sync-registry ignores it).
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createHmac } from "crypto";
import {
  verifyMetaSignature,
  metaVerifyChallenge,
  normalizeMetaWebhook,
  EVIDENCE_KEYS,
  capabilityForMetaMessage,
} from "@/engines/integration-gateway/adapters/meta";
import { isGatewayEvent } from "@/engines/integration-gateway/contracts/event";
import { listConnectContractIds } from "@/engines/connectors/registry";
import { sendConnectInboundSource } from "../local-runtime/connect-inbound.mjs";

const ROOT = join(__dirname, "..");
let pass = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
/** strip block + line comments so prose never counts as a write site */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── R2 — Meta signature verification (X-Hub-Signature-256) ──────────────────
const SECRET = "test-app-secret-not-a-real-credential";
const BODY = JSON.stringify({ object: "page", entry: [{ id: "P1", time: 1518479195594, messaging: [{ sender: { id: "S1" }, recipient: { id: "P1" }, timestamp: 1518479195308, message: { mid: "m1", text: "สวัสดี" } }] }] });
const goodSig = "sha256=" + createHmac("sha256", SECRET).update(BODY).digest("hex");
check("R2a valid Meta signature accepted", verifyMetaSignature(BODY, goodSig, SECRET) === true);
check("R2b tampered body rejected", verifyMetaSignature(BODY + " ", goodSig, SECRET) === false);
check("R2c wrong app secret rejected", verifyMetaSignature(BODY, goodSig, "another-secret") === false);
check("R2d missing signature header rejected", verifyMetaSignature(BODY, null, SECRET) === false);
check("R2e empty app secret rejected (fail-closed)", verifyMetaSignature(BODY, goodSig, "") === false);
check("R2f sha1-style header rejected (wrong scheme)", verifyMetaSignature(BODY, "sha1=abc", SECRET) === false);

// ── R2b — GET hub.challenge verification flow ───────────────────────────────
check("R2g correct verify_token echoes the challenge", metaVerifyChallenge({ mode: "subscribe", verifyToken: "my-token", challenge: "1158201444" }, "my-token") === "1158201444");
check("R2h wrong verify_token rejected", metaVerifyChallenge({ mode: "subscribe", verifyToken: "wrong", challenge: "1" }, "my-token") === null);
check("R2i wrong hub.mode rejected", metaVerifyChallenge({ mode: "unsubscribe", verifyToken: "my-token", challenge: "1" }, "my-token") === null);
check("R2j missing challenge rejected", metaVerifyChallenge({ mode: "subscribe", verifyToken: "my-token", challenge: null }, "my-token") === null);

// ── R1/R4 — receive data + deterministic dedup ──────────────────────────────
const pagePayload = {
  object: "page",
  entry: [
    { id: "PAGE123", time: 1518479195594, messaging: [
      // text message
      { sender: { id: "PSID1" }, recipient: { id: "PAGE123" }, timestamp: 1518479195308, message: { mid: "mid.1:abc", text: "โอนเงินแล้ว ยอด 50,000" } },
      // image attachment (slip)
      { sender: { id: "PSID1" }, recipient: { id: "PAGE123" }, timestamp: 1518479195400, message: { mid: "mid.2:def", attachments: [{ type: "image", payload: { url: "https://fbcdn.example/signed-S3CR3T" } }] } },
      // our own echo — must be skipped (inbound only)
      { sender: { id: "PAGE123" }, recipient: { id: "PSID1" }, timestamp: 1518479195500, message: { mid: "mid.3:echo", text: "ขอบคุณครับ", is_echo: true } },
      // read receipt — no business meaning, must be skipped
      { sender: { id: "PSID1" }, recipient: { id: "PAGE123" }, timestamp: 1518479195600, read: { mid: "mid.4:read" } },
    ] },
  ],
};
const pg = normalizeMetaWebhook(pagePayload);
check("R1a page text message → message.received / provider facebook", pg.events.some((e) => e.capability === "message.received" && e.provider === "facebook"), JSON.stringify(pg.events.map((e) => e.capability)));
check("R1b page image attachment → document.received (has_media)", pg.events.some((e) => e.capability === "document.received" && e.evidence.has_media === true));
check("R1c echo + receipt skipped, never invented", pg.skipped === 2, `skipped=${pg.skipped}`);
check("R1d all emitted events satisfy the canonical GatewayEvent contract", pg.events.length > 0 && pg.events.every((e) => isGatewayEvent(e)));
check("R1e observe-only (requested_effect none / action observe / channel observe)", pg.events.every((e) => e.requested_effect === "none" && e.action === "observe" && e.channel === "observe"));
check("R1f event_id deterministic from provider message id", pg.events[0].event_id === "EVT-facebook-mid.1:abc", pg.events[0].event_id);
check("R1g provider timestamp preserved in occurred_at", pg.events[0].occurred_at === new Date(1518479195308).toISOString(), pg.events[0].occurred_at);
check("R1h sender + conversation + account retained (owner audit facts)", pg.events[0].evidence.sender_id === "PSID1" && pg.events[0].evidence.conversation_id === "PSID1" && pg.events[0].evidence.entry_id === "PAGE123" && pg.events[0].evidence.recipient_id === "PAGE123");
check("R1i message id + source time retained", pg.events[0].evidence.webhook_event_id === "mid.1:abc" && typeof pg.events[0].evidence.provider_timestamp === "number");
check("R1j real file evidence retained for attachments (type list)", ((pg.events[1].evidence.attachment_types as string[]) ?? [])[0] === "image" && pg.events[1].evidence.has_media === true);

// R4 — redelivery/duplicate: normalizing the SAME payload twice yields identical ids →
// the evidence store upserts on event_id (idempotent retry, same as EVT-line-*).
const pg2 = normalizeMetaWebhook(pagePayload);
check("R4a duplicate delivery → identical event_ids (idempotent upsert basis)", JSON.stringify(pg2.events.map((e) => e.event_id)) === JSON.stringify(pg.events.map((e) => e.event_id)));

// instagram surface → provider instagram; unknown object → skipped honestly
const igPayload = {
  object: "instagram",
  entry: [{ id: "IGID1", time: 1569262486134, messaging: [{ sender: { id: "IGSID1" }, recipient: { id: "IGID1" }, timestamp: 1569262485349, message: { mid: "ig.mid:1", text: "ใบแจ้งหนี้" } }] }],
};
const ig = normalizeMetaWebhook(igPayload);
check("R1k instagram message → provider instagram / message.received", ig.events.length === 1 && ig.events[0].provider === "instagram" && ig.events[0].capability === "message.received");
check("R1l unknown object type skipped, never invented", normalizeMetaWebhook({ object: "user", entry: [{ id: "U" }] }).skipped === 1);
check("R1m null payload → no events, no throw", normalizeMetaWebhook(null).events.length === 0);

// ── H-family — evidence key whitelist (no customer content / no signed URL leak) ──
const leaked = [...pg.events, ...ig.events].flatMap((e) => Object.keys(e.evidence).filter((k) => !EVIDENCE_KEYS.includes(k)));
check("H-evidence1 every emitted evidence key is whitelisted", leaked.length === 0, leaked.join(","));
const allEvidence = JSON.stringify([...pg.events, ...ig.events].map((e) => e.evidence));
check("H-evidence2 raw message text never enters evidence", !allEvidence.includes("50,000") && !allEvidence.includes("ใบแจ้งหนี้"));
check("H-evidence3 signed attachment URL never enters evidence", !allEvidence.includes("fbcdn") && !allEvidence.includes("S3CR3T"));
check("H-evidence4 capability verbs stay provider-agnostic (same set as LINE)", capabilityForMetaMessage(true, "image") === "document.received" && capabilityForMetaMessage(false, "text") === "message.received");


// ── R3/R6 — inbound bridge transport (local-runtime → Connect central) ──────
// All network calls are stubbed on globalThis.fetch — nothing leaves this process.
// Declared as a function (repo compiles to CJS — no top-level await); the tail
// of the test runs inside .then() so the summary reflects every check.
async function bridgeTransportTests(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  // R6: missing env = fail-closed BEFORE any network attempt
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("network must not be touched"); }) as typeof fetch;
  const noEnv = await sendConnectInboundSource({}, { channel: "drive" }, "test");
  check("R6a missing env → {ok:false} INBOUND_CONNECT_TRANSPORT_NOT_CONFIGURED", noEnv.ok === false && noEnv.error === "INBOUND_CONNECT_TRANSPORT_NOT_CONFIGURED", noEnv.error);
  check("R6b missing env → zero network attempts (no silent fallback)", fetchCalls === 0, `fetchCalls=${fetchCalls}`);
  const halfEnv = await sendConnectInboundSource({ DNA_OS_APP_URL: "http://localhost:3000" }, {}, "test");
  check("R6c missing secret half of two-sided config → fail-closed too", halfEnv.ok === false && halfEnv.error === "INBOUND_CONNECT_TRANSPORT_NOT_CONFIGURED");

  // R3: transport failure (server unreachable / fetch throws) → ok:false, error reported
  globalThis.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
  const netFail = await sendConnectInboundSource({ DNA_OS_APP_URL: "http://127.0.0.1:1", INBOUND_SOURCE_INTERNAL_SECRET: "s" }, { channel: "drive" }, "test");
  check("R3a network failure → ok:false with real error (caller reports, no fallback)", netFail.ok === false && String(netFail.error).includes("ECONNREFUSED"), netFail.error);

  // R3b: canonical writer rejects (422 fail-closed) → ok:false, writer's error surfaces
  globalThis.fetch = (async () => ({ ok: false, status: 422, json: async () => ({ ok: false, error: "INBOUND_EVIDENCE_REQUIRED" }) })) as unknown as typeof fetch;
  const rejected = await sendConnectInboundSource({ DNA_OS_APP_URL: "http://x", INBOUND_SOURCE_INTERNAL_SECRET: "s" }, { channel: "drive" }, "test");
  check("R3b canonical writer rejection → ok:false with writer's error", rejected.ok === false && rejected.error === "INBOUND_EVIDENCE_REQUIRED", rejected.error);

  // happy path: bridge round-trips the writer's envelope
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { receipt_document_id: "r1", status: "ai_read", unlinked: true, media_verified: false } }) })) as unknown as typeof fetch;
  const okRes = await sendConnectInboundSource({ DNA_OS_APP_URL: "http://x", INBOUND_SOURCE_INTERNAL_SECRET: "s" }, { channel: "drive" }, "test");
  const okData = okRes.data as { receipt_document_id?: string } | undefined;
  check("R3c success path returns the writer's data envelope", okRes.ok === true && okData?.receipt_document_id === "r1");

  globalThis.fetch = originalFetch;
}

// Tail runs after the async bridge tests settle so the summary counts every check.
void bridgeTransportTests().then(() => {


  // ── R5 — retry semantics of the Meta observe route (static, route never runs here) ──
  const route = read("app/api/gateway/observe/meta/route.ts");
  check("R5a publish failure answers 500 so Meta retries the delivery", /status: 500/.test(route) && route.includes("if (!result.ok)"));
  check("R5b missing META_APP_SECRET → 503 fail-closed (no half-open endpoint)", route.includes("status: 503") && route.includes("META_APP_SECRET"));
  check("R5c invalid signature → 401", route.includes("status: 401") && route.includes("verifyMetaSignature"));
  check("R5d GET verification answers 403 on bad verify_token", route.includes("status: 403") && route.includes("metaVerifyChallenge"));
  check("R5e route touches NO business table directly (publish only)", !/\.from\(\s*["'][a-z_]+["']\s*\)\s*\.\s*(insert|update|delete|upsert)/.test(stripComments(route)));
  check("R5f route never calls the inbound bridge (document leg honestly NOT WIRED — no credential)", !route.includes("sendConnectInboundSource") && !route.includes("connect/inbound-source"));
  const adapterSrc = stripComments(read("engines/integration-gateway/adapters/meta.ts"));
  // table-literal .from("...") only — Buffer.from() is string handling, not a DB call
  check("R5g adapter has no DB client / no business write", !adapterSrc.includes("supabase") && !/\.from\(\s*["']/.test(adapterSrc));

  // ── H1 — LINE account audit: destination threaded into line_events ────────
  const types = read("supabase/functions/line-webhook-v2/events/types.ts");
  const indexSrc = read("supabase/functions/line-webhook-v2/index.ts");
  const store = read("supabase/functions/line-webhook-v2/events/store.ts");
  check("H1a HandlerContext carries channelDestination", types.includes("channelDestination: string | null"));
  check("H1b index.ts threads payload.destination into ctx", indexSrc.includes("channelDestination: typeof payload.destination"));
  check("H1c saveEvent input accepts channelDestination", store.includes("channelDestination?: string | null"));
  check("H1d store persists extracted.channel_destination (additive jsonb, no schema change)", store.includes("channel_destination: channelDestination"));
  check("H1e empty extraction + no destination keeps extracted null (old shape preserved)", store.includes("input.extracted || channelDestination") && store.includes(": null"));
  const handlers = ["audio", "fallback", "file", "follow", "group", "image", "location", "postback", "text", "unfollow"];
  const missingHandlers = handlers.filter((h) => !read(`supabase/functions/line-webhook-v2/handlers/${h}.ts`).includes("channelDestination: ctx.channelDestination"));
  check("H1f all 10 handlers pass channelDestination to saveEvent", missingHandlers.length === 0, missingHandlers.join(","));


  // ── H2 — local-runtime creates rows ONLY through the Connect bridge ───────
  const scripts = ["local-runtime/watch-drive.mjs", "local-runtime/backfill-slips.mjs", "local-runtime/backfill-slips-test.mjs"];
  const offenders: string[] = [];
  for (const s of scripts) {
    const src = stripComments(read(s));
    if (/\.from\(\s*["']receipt_documents["']\s*\)\s*\.\s*(insert|update|upsert)/.test(src)) offenders.push(s);
  }
  check("H2a no direct receipt_documents write remains in local-runtime", offenders.length === 0, offenders.join(","));
  const importMissing = scripts.filter((s) => !read(s).includes("sendConnectInboundSource"));
  check("H2b all three scripts import the Connect bridge", importMissing.length === 0, importMissing.join(","));
  const helper = stripComments(read("local-runtime/connect-inbound.mjs"));
  check("H2c bridge helper has NO supabase client and NO .from( write", !helper.includes("supabase") && !/\.from\(\s*["']/.test(helper));
  check("H2d bridge helper is fail-closed (env check precedes fetch)", helper.indexOf("INBOUND_CONNECT_TRANSPORT_NOT_CONFIGURED") < helper.indexOf("fetch("));
  const drive = read("local-runtime/watch-drive.mjs");
  check("H2e watcher uses channel 'drive' + local_drive media_path (real origin kept)", drive.includes('channel: "drive"') && drive.includes("local_drive:"));
  check("H2f watcher failure throws BEFORE processed-log append (retry next round, no fabrication)", drive.includes("if (!created.ok) throw") && drive.indexOf("if (!created.ok) throw") < drive.indexOf("appendFileSync(PROCESSED_LOG"));
  for (const s of ["local-runtime/backfill-slips.mjs", "local-runtime/backfill-slips-test.mjs"]) {
    const src = read(s);
    const label = s.split("/").pop();
    check(`H2g ${label} uses channel 'upload' + local_backfill origin (not stamped for any other channel)`, src.includes('channel: "upload"') && src.includes("local_backfill:"));
    check(`H2h ${label} bridge failure counts as failed (no fabricated row)`, src.includes("if (!created.ok) throw"));
  }

  // ── H3 — vocabulary not stretched in CODE; expansion lives only in drafts ──
  const inboundRoute = read("app/api/internal/connect/inbound-source/route.ts");
  check("H3a inbound-source ALLOWED_CHANNELS still exactly the original 5", inboundRoute.includes('"line", "upload", "email", "bank", "drive"') && !inboundRoute.includes("facebook") && !inboundRoute.includes("instagram"));
  const inboundWriter = read("engines/canonical/inbound-write.ts");
  check("H3b canonical InboundChannel unchanged (no new value before migration)", inboundWriter.includes('"line" | "upload" | "email" | "bank" | "drive"') && !inboundWriter.includes("facebook"));
  const adminRoute = read("app/api/admin/receipt-documents/route.ts");
  check("H3c admin receipt-documents channels unchanged", adminRoute.includes('"line", "upload", "email", "bank", "drive"') && !adminRoute.includes("facebook"));
  const m1 = read("supabase/migrations/20261007000001_propose_meta_gateway_providers.sql");
  check("H3d gateway provider expansion exists as a draft proposal", m1.includes("PROPOSED") && m1.includes("NOT APPLIED") && m1.includes("'facebook', 'instagram'"));
  check("H3e provider draft states its impact + release order (migration-before-code)", m1.includes("IMPACT") && m1.includes("RELEASE ORDER"));
  const m2 = read("supabase/migrations/20261007000002_propose_source_channel_meta.sql");
  check("H3f source_channel expansion exists as a draft proposal, NOT applied", m2.includes("PROPOSED") && m2.includes("NOT APPLIED") && m2.includes("'facebook','instagram'"));
  check("H3g source_channel draft states impact (3 allow-lists) + release order", m2.includes("IMPACT") && m2.includes("RELEASE ORDER") && m2.includes("inbound-write.ts"));


  // ── H4 — TikTok NOT claimed (official webhooks carry no message events) ────
  check("H4a no adapter was invented for TikTok", !existsSync(join(ROOT, "engines/integration-gateway/adapters/tiktok.ts")));
  check("H4b no observe route was invented for TikTok", !existsSync(join(ROOT, "app/api/gateway/observe/tiktok")));
  check("H4c TikTok not registered in Connect contracts", !listConnectContractIds().includes("tiktok"));
  const caps = read("plugins/capabilities.ts");
  const tiktokLine = caps.split("\n").find((l) => l.includes('id: "tiktok"')) ?? "";
  check("H4d catalog still reports tiktok disabled (never fabricated as connected)", tiktokLine.includes('status: "disabled"'), tiktokLine.trim());
  const fbLine = caps.split("\n").find((l) => l.includes('id: "facebook"')) ?? "";
  const igLine = caps.split("\n").find((l) => l.includes('id: "instagram"')) ?? "";
  check("H4e facebook/instagram still report auth_required (no credential = not connected)", fbLine.includes('status: "auth_required"') && igLine.includes('status: "auth_required"'));

  // ── H5/H6 — contract extension + no secrets in the example file ───────────
  const contract = read("engines/integration-gateway/contracts/event.ts");
  check("H5a GatewayProvider contract extended for facebook + instagram", contract.includes('"facebook"') && contract.includes('"instagram"'));
  const example = read(".env.local.example");
  check("H6a META_APP_SECRET present but EMPTY in the example (no secret in source)", /^META_APP_SECRET=$/m.test(example));
  check("H6b META_VERIFY_TOKEN present but EMPTY in the example", /^META_VERIFY_TOKEN=$/m.test(example));

  // ── NC — negative controls (the scanners must catch what they claim) ──────
  const injected = "await db.from(" + "'receipt_documents'" + ").insert({ amount: 1 });";
  check("NC1 an injected local-runtime-style direct insert IS detected", /\.from\(\s*["']receipt_documents["']\s*\)\s*\.\s*(insert|update|upsert)/.test(injected));
  const commented = "// await db.from(" + "'receipt_documents'" + ").insert({ amount: 1 });";
  check("NC1b a commented-out write is NOT counted (comment stripping is real)", /\.from\(\s*["']receipt_documents["']\s*\)\s*\.\s*(insert|update|upsert)/.test(stripComments(commented)) === false);
  check("NC2 a structurally-valid but wrong Meta signature IS rejected", verifyMetaSignature(BODY, "sha256=" + "0".repeat(64), SECRET) === false);
  check("NC3 a challenge with the wrong verify_token IS rejected", metaVerifyChallenge({ mode: "subscribe", verifyToken: "not-mine", challenge: "42" }, "mine") === null);

  console.log(`\n${pass}/${pass + failures.length} passed`);
  if (failures.length) {
    console.error(`FAILED: ${failures.join(" | ")}`);
    process.exit(1);
  }
  console.log("connect-channel-receive: receive/signature/load-fail/dup/retry/central-fail + LINE account audit + no-direct-write + vocabulary honesty all hold (offline)");
}).catch((err) => {
  console.error("connect-channel-receive: unexpected error", err);
  process.exit(1);
});

check("R2k empty expected token rejected (env not configured)", metaVerifyChallenge({ mode: "subscribe", verifyToken: "", challenge: "1" }, "") === null);
