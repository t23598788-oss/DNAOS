/**
 * Capability D — Business Event canonical authority test (2026-09-23).
 *
 * Proves, offline (no DB, no network):
 *   D0  repository-wide census: NO mutation of business_events exists outside
 *       engines/canonical/event-write.ts (the cutover acceptance gate)
 *   D1  exactly ONE canonical writer (BUSINESS_EVENT_WRITE_AUTHORITY_COUNT = 1)
 *   D2  the writer's command surface is closed: create / transition / enrich /
 *       link_transaction with an explicit field allow-list (no arbitrary patch,
 *       no provider object spread)
 *   D3  the four PROVEN transitions are exactly those the source proves
 *   D4  provider paths reach events only through the Connect boundary
 *   D5  financial authority untouched (B-04 still the only payment authority)
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  BUSINESS_EVENT_STATES,
  createBusinessEvent,
  transitionBusinessEvent,
  enrichBusinessEvent,
  linkBusinessEventTransaction,
} from "@/engines/canonical/event-write";

const ROOT = join(__dirname, "..");
const WRITER = "engines/canonical/event-write.ts";
const BRIDGE = "app/api/internal/connect/event/route.ts";
const TRANSPORT = "supabase/functions/_shared/connect-event.ts";

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
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf-8");
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// ── D0/D1 — the authority census ────────────────────────────────────────────
const WRITE_OP = /\.from\("business_events"\)[\s\S]{0,240}?\.(insert|upsert|update|delete)\s*\(/;
const offenders: string[] = [];
let writerOps = 0;
const walk = (relDir: string): void => {
  for (const entry of readdirSync(join(ROOT, relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(rel);
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
    const code = stripComments(read(rel));
    if (WRITE_OP.test(code)) {
      if (rel === WRITER) writerOps += 1;
      else offenders.push(rel);
    }
  }
};
for (const dir of ["app", "core", "engines", "services", "gateway", "supabase", "scripts"]) walk(dir);
check("D0 no business_events mutation outside the canonical writer", offenders.length === 0, offenders.join(", "));
check("D1 exactly one canonical authority holds every mutation", writerOps === 1, `writer mutation source=${writerOps}`);

// ── D2 — closed command surface / explicit allow-list ───────────────────────
const writerSrc = stripComments(read(WRITER));
check(
  "D2 exposes the four canonical commands",
  ["export async function createBusinessEvent", "export async function transitionBusinessEvent", "export async function enrichBusinessEvent", "export async function linkBusinessEventTransaction"].every((sig) => writerSrc.includes(sig)),
);
check("D2 has an explicit field allow-list", writerSrc.includes("ENRICHABLE_FIELDS"));
check("D2 never spreads a caller object into the DB", !/\.insert\(\s*\{\s*\.\.\./.test(writerSrc) && !/\.update\(\s*\{\s*\.\.\./.test(writerSrc));
check("D2 rejects fields outside the allow-list", writerSrc.includes("EVENT_FIELD_NOT_ALLOWED"));
check("D2 refuses an unknown state", writerSrc.includes("EVENT_UNKNOWN_STATE"));
check("D2 vocabulary is source-derived (sent/new/quotation_pending present)", BUSINESS_EVENT_STATES.includes("sent") && BUSINESS_EVENT_STATES.includes("new") && BUSINESS_EVENT_STATES.includes("quotation_pending"));

// ── runtime unit checks (the writer refuses before it can touch a DB) ──────
const fakeDb = {
  from: () => ({
    insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
    update: () => ({ eq: async () => ({ error: null }) }),
  }),
} as never;

void (async () => {
  const badState = await createBusinessEvent(fakeDb, { eventCode: "X", title: "t", eventDate: "2026-01-01", eventType: null, source: { provider: "line", externalSubjectId: null }, status: "invented_state", actor: "t" } as never);
  check("D2 create refuses an invented state", badState.ok === false && String(badState.error).startsWith("EVENT_UNKNOWN_STATE"), badState.error);

  const badField = await enrichBusinessEvent(fakeDb, { eventId: "e", fields: { arbitrary_column: 1 }, actor: "t" });
  check("D2 enrich refuses a field outside the allow-list", badField.ok === false && String(badField.error).startsWith("EVENT_FIELD_NOT_ALLOWED"), badField.error);

  const badTransition = await transitionBusinessEvent(fakeDb, { eventId: "e", from: "awaiting_payment", to: "cancelled", actor: "t" });
  check("D3 refuses a from→to pair the source does not prove", badTransition.ok === false && String(badTransition.error).startsWith("EVENT_TRANSITION_REFUSED"), badTransition.error);

  // D3 — the four PROVEN transitions (each guard proven in source)
  const proven: [string, string][] = [
    ["awaiting_payment", "payment_confirmed"],
    ["awaiting_payment_date", "confirmed"],
    ["quotation_pending", "awaiting_info"],
    ["quotation_pending", "ready_to_quote"],
  ];
  for (const [from, to] of proven) {
    const ok = await transitionBusinessEvent(fakeDb, { eventId: "e", from, to, actor: "t" });
    check(`D3 proven transition accepted (${from} → ${to})`, ok.ok === true, ok.error);
  }

  const linkSrc = writerSrc.slice(writerSrc.indexOf("export async function linkBusinessEventTransaction"));
  check("D4 link_transaction changes no state", !/status/.test(linkSrc.split("}")[0] + linkSrc.slice(0, 400)));
  const linked = await linkBusinessEventTransaction(fakeDb, { eventId: "e", transactionId: "t", actor: "test" });
  check("D4 link_transaction accepted without touching money", linked.ok === true, linked.error);

  // ── D4 — provider boundary ────────────────────────────────────────────────
  const bridgeSrc = stripComments(read(BRIDGE));
  check("D4 bridge rejects unknown commands", bridgeSrc.includes("unknown command"));
  check("D4 bridge requires an actor", bridgeSrc.includes("actor is required"));
  check("D4 bridge maps fields explicitly (no payload spread)", !/\.\.\.p\b/.test(bridgeSrc) && !/\.\.\.payload/.test(bridgeSrc));
  check("D4 bridge has no provider payload parsing", !/events\[|message\.text|replyToken|source\.userId/.test(bridgeSrc));
  check("D4 bridge is fail-closed without its secret", bridgeSrc.includes("CONNECT_INTERNAL_SECRET") && bridgeSrc.includes("503"));
  const transportSrc = stripComments(read(TRANSPORT));
  check("D4 transport knows only the canonical commands", transportSrc.includes("business_event.create") && transportSrc.includes("business_event.link_transaction"));
  check("D4 transport never touches the business table or its columns", !/business_events|source_line_user_id|\.from\(/.test(transportSrc));
  check("D4 transport is fail-closed", transportSrc.includes("CONNECT_TRANSPORT_NOT_CONFIGURED") && transportSrc.includes("catch"));

  // ── NC5/NC6/NC8 — boundary assertions that must catch a regression ─────────
  const allowListSection = writerSrc.slice(writerSrc.indexOf("ENRICHABLE_FIELDS"), writerSrc.indexOf("export interface BusinessEventSource"));
  check(
    "NC5 no provider-shaped column can become an enrichable field",
    !/source_line_user_id/.test(allowListSection),
    "source_line_user_id found in ENRICHABLE_FIELDS",
  );
  check(
    "NC6 bridge never reads a provider payload shape",
    !/\bevents\b|deliveryContext|webhookEventId|message\.text|postback/.test(bridgeSrc),
    "bridge references a provider payload shape",
  );
  check(
    "NC6/N8 bridge validates the command before any use",
    bridgeSrc.indexOf("COMMANDS.includes(command") < bridgeSrc.indexOf("const p = obj(body.payload)"),
  );
  check(
    "N8 bridge forwards no injected/arbitrary fields",
    !/extra: \{/.test(bridgeSrc) && !/fields: \{/.test(bridgeSrc),
    "bridge builds an inline field object instead of passing the validated field map",
  );

  // ── D5 — financial authority untouched ────────────────────────────────────
  check("D5 event writer never mutates money tables", !/payment_allocations|invoice_payments|debt_events|debt_snapshots|confirm_payment_allocation/.test(writerSrc));
  check("D5 B-04 payment writer remains the payment authority", read("engines/canonical/payment-write.ts").includes('db.rpc("confirm_payment_allocation"'));

  console.log(`\n${checks - failures}/${checks} passed`);
  if (failures > 0) {
    console.log(`${failures} FAILED`);
    process.exit(1);
  }
})();

