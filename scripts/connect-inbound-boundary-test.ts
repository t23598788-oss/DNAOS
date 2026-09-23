/**
 * Capability A — provider receive/webhook boundary test (2026-09-23).
 *
 * Proves, offline (no DB, no network, no credentials):
 *   A1  LINE signature verification is real (valid / tampered / wrong secret / missing)
 *   A2  a raw LINE payload normalizes into canonical GatewayEvents (batch aware)
 *   A3  business meaning is provider-agnostic capabilities, never the provider name
 *   A4  the evidence payload cannot leak customer content or a token (key whitelist)
 *   A5  unsupported provider event types are SKIPPED, never invented
 *   A6  every emitted event satisfies the canonical GatewayEvent contract
 *   A7  the provider is registered in Connect Core, existing providers intact
 *   A8  boundary discipline: raw provider payload fields exist only at the
 *       provider boundary + provider edge — never in Business Core
 *   A9  the gateway core stays provider-neutral and the ingress touches no business table
 *   A10 the LINE Edge boundary forwards the verified body to the ONE ingress, best-effort
 *   A11 the schema draft that lets provider='line' persist exists, is idempotent, NOT APPLIED
 *
 * Negative controls run separately by mutating one line at a time and re-running
 * this file; this file never mutates anything.
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { createHmac } from "crypto";
import { normalizeLineWebhook, verifyLineSignature, EVIDENCE_KEYS } from "@/engines/integration-gateway/adapters/line";
import { isGatewayEvent } from "@/engines/integration-gateway/contracts/event";
import { findContract, listConnectContractIds } from "@/engines/connectors/registry";

const ROOT = join(__dirname, "..");
let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks += 1;
  if (ok) {
    console.log(`PASS  ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

// ── A1 — signature verification ────────────────────────────────────────────
const SECRET = "test-channel-secret-not-a-real-credential";
const BODY = JSON.stringify({ destination: "Udest", events: [{ type: "message", message: { type: "text", text: "hi" } }] });
const goodSig = createHmac("sha256", SECRET).update(BODY).digest("base64");

check("A1 valid signature accepted", verifyLineSignature(BODY, goodSig, SECRET) === true);
check("A1 tampered body rejected", verifyLineSignature(BODY + " ", goodSig, SECRET) === false);
check("A1 wrong secret rejected", verifyLineSignature(BODY, goodSig, "another-secret") === false);
check("A1 missing signature rejected", verifyLineSignature(BODY, null, SECRET) === false);
check("A1 empty secret rejected", verifyLineSignature(BODY, goodSig, "") === false);

// ── A2/A3/A5/A6 — normalization ────────────────────────────────────────────
const payload = {
  destination: "Udest",
  events: [
    { type: "message", webhookEventId: "01H1", timestamp: 1758600000000, source: { type: "user", userId: "U1" }, message: { type: "text", id: "m1", text: "สั่งปูน 5 คิว" } },
    { type: "message", webhookEventId: "01H2", timestamp: 1758600001000, source: { type: "user", userId: "U1" }, message: { type: "image", id: "m2" } },
    { type: "message", webhookEventId: "01H3", timestamp: 1758600002000, source: { type: "user", userId: "U1" }, message: { type: "location", id: "m3" } },
    { type: "follow", webhookEventId: "01H4", timestamp: 1758600003000, source: { type: "user", userId: "U2" } },
    { type: "postback", webhookEventId: "01H5", timestamp: 1758600004000, source: { type: "user", userId: "U1" }, postback: { data: "x" } },
    { type: "beacon", webhookEventId: "01H6", timestamp: 1758600005000, source: { type: "user", userId: "U1" } },
  ],
};

const { events, skipped } = normalizeLineWebhook(payload);

check("A2 batch normalized to one event per supported entry", events.length === 5, `got ${events.length}`);
check("A5 unsupported event type skipped, not invented", skipped === 1, `skipped=${skipped}`);
check("A6 all emitted events satisfy GatewayEvent", events.every((e) => isGatewayEvent(e)));
check("A6 all events are observe-only", events.every((e) => e.requested_effect === "none" && e.action === "observe" && e.channel === "observe"));
check("A2 event ids deterministic from the provider event id", events[0].event_id === "EVT-line-01H1", events[0].event_id);
check("A2 provider recorded as the boundary provider id", events.every((e) => e.provider === "line"));
check("A2 provider timestamp preserved in occurred_at", events[0].occurred_at === new Date(1758600000000).toISOString(), events[0].occurred_at);

const capOf = (i: number) => events[i].capability;
check("A3 text message -> message.received", capOf(0) === "message.received", capOf(0));
check("A3 image message -> document.received", capOf(1) === "document.received", capOf(1));
check("A3 location message -> location.received", capOf(2) === "location.received", capOf(2));
check("A3 follow -> identity.signal.received", capOf(3) === "identity.signal.received", capOf(3));
check("A3 postback -> interaction.received", capOf(4) === "interaction.received", capOf(4));
check("A3 capability names carry no provider name", events.every((e) => !e.capability.includes("line")));

// ── A4 — evidence key whitelist (no content/token leak) ────────────────────
const leaked = events.flatMap((e) => Object.keys(e.evidence).filter((k) => !EVIDENCE_KEYS.includes(k)));
check("A4 evidence uses only whitelisted keys", leaked.length === 0, leaked.join(","));
const serialized = JSON.stringify(events.map((e) => e.evidence));
check("A4 customer message text never enters evidence", !serialized.includes("สั่งปูน"));
check("A4 provider user id never enters evidence", !serialized.includes("\"U1\""));
check("A4 no token/secret/signature field leaks into evidence", !/token|secret|signature/i.test(serialized));

// ── A7 — Connect Core registration ─────────────────────────────────────────
const contract = findContract("line");
check("A7 findContract('line') resolves", !!contract);
check("A7 providerId is 'line'", contract?.providerId === "line", contract?.providerId);
check("A7 auth mode is token (what the live credential path uses)", contract?.authModes.includes("token") === true);
check("A7 approval is OWNER_REQUIRED", contract?.approvalRequirement === "OWNER_REQUIRED");
const declared = new Set((contract?.capabilityMetadata() ?? []).map((c) => c.id));
const emitted = new Set(events.map((e) => e.capability));
check("A7 declared capabilities cover every emitted capability", [...emitted].every((c) => declared.has(c)), [...emitted].filter((c) => !declared.has(c)).join(","));
check("A7 capability labels are locale keys, not display literals", (contract?.capabilityMetadata() ?? []).every((c) => c.label_key.startsWith("connect.capability.")));
const ids = listConnectContractIds();
check("A7 registry keeps the two existing providers", ids.includes("github") && ids.includes("railway"), ids.join(","));
check("A7 registry now includes line", ids.includes("line"), ids.join(","));

// ── A8 — boundary discipline (raw provider payload stays at the boundary) ──
const boundaryFiles = ["engines/integration-gateway/adapters/line.ts", "app/api/gateway/observe/line/route.ts"];
const rawFieldNames = ["webhookEventId", "deliveryContext", "isRedelivery"];
const offenders: string[] = [];
const walk = (relDir: string): void => {
  for (const entry of readdirSync(join(ROOT, relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(rel);
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
    if (boundaryFiles.includes(rel) || rel.startsWith("supabase/functions/")) continue;
    const src = read(rel);
    for (const field of rawFieldNames) if (src.includes(field)) offenders.push(`${rel}:${field}`);
  }
};
for (const dir of ["app", "core", "engines", "services", "gateway", "presentation"]) walk(dir);
check("A8 raw provider payload fields exist only at the boundary/provider edge", offenders.length === 0, offenders.join(" "));

// ── A9 — gateway core stays provider-neutral ───────────────────────────────
for (const rel of ["engines/integration-gateway/event-bus/bus.ts", "engines/integration-gateway/policy/gate.ts", "engines/integration-gateway/evidence/store.ts"]) {
  check(`A9 ${rel} has no provider branch`, !/"line"/.test(read(rel)));
}
const routeSrc = read("app/api/gateway/observe/line/route.ts");
check("A9 ingress touches no business table", !/business_events|companies|customer_orders|receipt_documents|payment_allocations|invoices/.test(routeSrc));
check("A9 ingress publishes through the canonical bus only", /event-bus\/bus/.test(routeSrc) && /publish\(/.test(routeSrc));
check("A9 ingress is fail-closed on a missing secret", /LINE_CHANNEL_SECRET/.test(routeSrc) && /503/.test(routeSrc));
const adapterSrc = read("engines/integration-gateway/adapters/line.ts");
check("A9 adapter has no database access at all", !/supabaseAdmin|createClient|\.from\("/.test(adapterSrc));
const lineContractSrc = read("engines/connectors/providers/line.ts");
check("A9 connect contract has no database access", !/supabaseAdmin|createClient|\.from\("/.test(lineContractSrc));
check("A9 connect contract never carries a secret value", !/channel_access_token\s*:\s*"/.test(lineContractSrc) && /REQUIRED_SECRET_KEYS/.test(lineContractSrc));

// ── A10 — provider edge forwards to the ONE ingress, best-effort ───────────
const forwardSrc = read("supabase/functions/_shared/connect-forward.ts");
const forwardCode = forwardSrc.replace(/\/\/[^\n]*/g, "");
check("A10 forward targets the canonical observe ingress", forwardSrc.includes("/api/gateway/observe/line"));
check("A10 forward carries no credential of its own", !/secret|Bearer|Authorization/i.test(forwardCode));
check("A10 forward is timeout-guarded", /AbortSignal\.timeout\(/.test(forwardSrc));
const indexPath = "supabase/functions/line-webhook-v2/index.ts";
const indexSrc = read(indexPath);
check("A10 webhook boundary imports the forwarder", indexSrc.includes("forwardLineInbound"));
check("A10 webhook boundary verifies the signature before forwarding", indexSrc.indexOf("verifyLineSignature(") < indexSrc.indexOf("forwardLineInbound("));
check("A10 webhook boundary keeps its existing handling untouched", indexSrc.includes("await handleText(ctx)") && indexSrc.includes("processEvent"));

// ── A11 — schema draft ─────────────────────────────────────────────────────
const migrationPath = "supabase/migrations/20260923000002_gateway_allow_line_provider.sql";
check("A11 provider CHECK draft exists", existsSync(join(ROOT, migrationPath)));
const migrationSrc = read(migrationPath);
check("A11 draft allows provider 'line'", /'line'/.test(migrationSrc));
const allowListLines = migrationSrc.split("\n").filter((l) => l.includes("check (provider in ("));
check(
  "A11 EVERY provider allow-list line allows 'line' (no partial list)",
  allowListLines.length >= 2 && allowListLines.every((l) => l.includes("'line'")),
  allowListLines.map((l) => l.trim()).join(" | "),
);
check("A11 draft is marked NOT APPLIED", /Status: NOT APPLIED/.test(migrationSrc));
check("A11 draft is idempotent (discovers the constraint name)", migrationSrc.includes("pg_get_constraintdef(oid) ilike '%provider%'"));
check("A11 draft keeps the explicit allow-list discipline", /check \(provider in \(/.test(migrationSrc));
check("A11 draft never drops a table", !/drop table/i.test(migrationSrc));

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}

