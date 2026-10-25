/**
 * OWNERSHIP / PUBLICATION REPAIR — verification suite (owner mission 2026-10-19)
 *
 * READ-ONLY. Every LIVE check is a SELECT or a pure function call; this file
 * never inserts, updates or deletes. It proves three separate things, and keeps
 * them labelled so a passing build cannot stand in for a passing data check:
 *
 *   STATIC     the matching paths / writers / prepared migrations have the shape
 *              the repair claims (closed supply excluded, ownership gate present,
 *              RLS fix free of self-reference)
 *   SYNTHETIC  the pure publication policy behaves correctly on fixtures
 *   LIVE       the deployed reader functions actually exclude closed/deleted/
 *              unpriced supply on the real database (read-only queries only)
 *
 * Run: npx tsx scripts/ownership-publication-boundary-test.ts
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

// The engine modules read env lazily; load the project's local env first so the
// LIVE checks hit the same database the app does. No values are printed.
for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

import { decidePublication, publicationState } from "../engines/matching/publication";
import { pickIssuerCompanyId } from "../engines/canonical/document-write";
import { findNearestPit } from "../engines/distance";
import { dispatch } from "../engines/validation/dispatcher";
import { listPublicRegistry } from "../engines/public-registry/service";
import { supabaseAdmin } from "../services/supabase/queries";

type Result = { level: "STATIC" | "SYNTHETIC" | "LIVE"; label: string; ok: boolean; detail?: string };
const results: Result[] = [];
function check(level: Result["level"], label: string, ok: boolean, detail?: string) {
  results.push({ level, label, ok, detail });
}
const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const PRIVATE_KEYS = ["user_id", "line_user_id", "taxpayer_id", "tax_id", "bank_account_number", "bank_name", "phone", "contact_name"];

async function main() {
  // ───────────────────────────── STATIC ─────────────────────────────
  const distance = read("engines/distance.ts");
  check("STATIC", "distance: external query restricts is_open", distance.includes('.eq("is_open", true)'));
  check("STATIC", "distance: single publication decision is used", distance.includes("decidePublication("));
  check("STATIC", "distance: unpublished widening is explicit + internal-only option", distance.includes("includeUnpublished"));
  check("STATIC", "distance: requires a priced link (no empty-filter fallback)", distance.includes("prices: pricesByPit.get(pit.id)") && !distance.includes("if (mats && mats.length > 0)"));

  const dispatcher = read("engines/validation/dispatcher.ts");
  check("STATIC", "dispatcher: pit.find applies publication filter", dispatcher.includes('pitsQuery.eq("is_open", true)'));
  check("STATIC", "dispatcher: pit.find reports publication_filter", dispatcher.includes("publication_filter"));
  check("STATIC", "dispatcher: material.sources passes the boundary option", dispatcher.includes("{ includeUnpublished }"));
  check("STATIC", "dispatcher: sales sandbox can never widen to unpublished", dispatcher.includes('ctx?.system === true && ctx?.sandbox !== "sales"'));

  const registry = read("engines/public-registry/service.ts");
  check("STATIC", "registry: public listing requires a real price > 0", registry.includes(".filter((m) => Number(m.price) > 0)"));
  check("STATIC", "registry: public listing exposes ownership evidence, not private ids", registry.includes("owner_evidence: decision.owner_evidence") && registry.includes("owner_verified: decision.owner_verified"));

  // Every supply writer must pass the existing ownership gate (fail-closed 403).
  const gated = ["addMyMaterialListing", "updateMyMaterialPrice", "recordMyStockMovement", "updateMyResourceSite"];
  for (const fn of gated) {
    const start = registry.indexOf(`export async function ${fn}`);
    const next = registry.indexOf("\nexport ", start + 1);
    const body = start < 0 ? "" : registry.slice(start, next < 0 ? registry.length : next);
    check("STATIC", `owner gate: ${fn} calls assertPitOwnership before writing`, body.includes("assertPitOwnership("));
  }
  // updateMyAsset uses its own (equivalent) ownership predicate: the row must
  // match BOTH asset id and owner_user_id === caller before any update runs.
  const assetStart = registry.indexOf("export async function updateMyAsset");
  const assetNext = registry.indexOf("\nexport ", assetStart + 1);
  const assetBody = assetStart < 0 ? "" : registry.slice(assetStart, assetNext < 0 ? registry.length : assetNext);
  check(
    "STATIC",
    "owner gate: updateMyAsset requires owner_user_id === caller before writing",
    assetBody.includes(".eq(\"owner_user_id\", callerId)") && assetBody.includes("FORBIDDEN — ทรัพย์นี้ไม่ใช่ของบัญชีคุณ"),
  );

  // The Deno LINE bot is the real external customer channel and has its own
  // copy of the pricing engine — the boundary must hold there too.
  const lineQuote = read("supabase/functions/line-webhook-v2/engines/quote-price.ts");
  check("STATIC", "LINE quote engine: only open supply is quoted", lineQuote.includes('.eq("is_open", true)'));
  check("STATIC", "LINE quote engine: only real prices are quoted", lineQuote.includes('.gt("price", 0)'));

  const adminPits = read("app/api/admin/pits/route.ts");
  check("STATIC", "internal admin pit list stays unfiltered (management read preserved)", !adminPits.includes('.eq("is_open"'));
  check("STATIC", "public bar: admin pit reader still exists", adminPits.includes("export async function GET"));

  const rlsFix = read("supabase/migrations/20261019000001_org_members_rls_recursion_fix.sql");
  check("STATIC", "RLS fix: security-definer membership helpers", rlsFix.includes("create or replace function public.tenant_is_org_admin(org uuid)") && rlsFix.includes("security definer"));
  check("STATIC", "RLS fix: helpers not executable by anon", rlsFix.includes("revoke all on function public.tenant_is_org_admin(uuid)  from anon, public;"));
  const selectPolicy = rlsFix.split("drop policy if exists org_members_select_own_or_staff")[1]?.split("drop policy if exists")[0] ?? "";
  check("STATIC", "RLS fix: org_members select policy no longer self-selects", selectPolicy.length > 0 && !selectPolicy.includes("from public.org_members"));

  // ONE money-OUT writer: the subscription observer used to insert
  // company_expenses directly beside engines/canonical/expense-write.ts.
  const subSync = read("supabase/functions/subscription-email-sync/index.ts");
  check("STATIC", "subscription sync no longer inserts company_expenses directly", !subSync.includes('.from("company_expenses").insert('));
  check("STATIC", "subscription sync writes through the Connect expense bridge", subSync.includes("sendConnectExpenseCommand(") && subSync.includes('"expense.record"'));
  check("STATIC", "subscription sync keeps source=subscription_email_sync", subSync.includes('source: "subscription_email_sync"'));
  const expenseWriter = read("engines/canonical/expense-write.ts");
  check("STATIC", "canonical expense writer persists subscription_service_id", expenseWriter.includes("subscription_service_id: input.subscription_service_id ?? null"));
  const expenseBridge = read("app/api/internal/connect/expense/route.ts");
  check("STATIC", "expense bridge forwards source + subscription_service_id", expenseBridge.includes("source: str(p.source)") && expenseBridge.includes("subscription_service_id: str(p.subscription_service_id)"));

  // Parity: every column the removed direct insert persisted must still be
  // persisted by the canonical path. The previous version is read from git
  // HEAD, so this compares against the real old code, not a restatement.
  const headVersion = spawnSync("git", ["show", "HEAD:supabase/functions/subscription-email-sync/index.ts"], { encoding: "utf8" });
  const headBlock = headVersion.status === 0
    ? (headVersion.stdout.match(/from\("company_expenses"\)\.insert\(\{([\s\S]*?)\}\)/)?.[1] ?? "")
    : "";
  // capture `key: value` AND shorthand `key,` properties (e.g. `amount,`)
  const oldFields = [
    ...new Set(
      [...headBlock.matchAll(/^\s*([a-z_]+)\s*(?::|,|$)/gm)].map((m) => m[1]),
    ),
  ];
  check("STATIC", "old direct insert shape recovered from git HEAD", oldFields.length >= 5, oldFields.join(","));
  for (const field of oldFields) {
    const written = subSync.includes(`${field}`) || expenseBridge.includes(`${field}`) || expenseWriter.includes(`${field}`);
    check("STATIC", `parity: ${field} still persisted via canonical writer`, written);
  }

  const docProposal = read("supabase/migrations/20261019000002_document_issuer_ownership_proposal.sql");
  check("STATIC", "documents: issuer_company_id proposed additively", docProposal.includes("add column if not exists issuer_company_id uuid references public.companies(id)"));
  check("STATIC", "documents: organization_id proposed for issuer-side ownership", docProposal.includes("add column if not exists organization_id uuid references public.organizations(id)"));
  check("STATIC", "documents: proposal does NOT backfill", docProposal.includes("It deliberately does NOT:") && docProposal.includes("STOPPED FOR OWNER DECISION"));
  const docWriter = read("engines/canonical/document-write.ts");
  check("STATIC", "documents: canonical writer stamps issuer_company_id + organization_id", docWriter.includes("issuer_company_id: issuerCompanyId") && docWriter.includes("organization_id: documentOrganizationId"));
  check("STATIC", "documents: writer refuses an issuer outside the tenant organization", docWriter.includes("ISSUER_NOT_IN_ORGANIZATION"));
  check("STATIC", "documents: writer never guesses among several companies", docWriter.includes("org.size === 1 ? [...org][0] : null"));
  check("STATIC", "documents: writer skips stamping when ownership columns are not deployed (no broken writes)", docWriter.includes("hasOwnershipColumns") && docWriter.includes('"columns_not_deployed"'));

  // ───────────────────────────── SYNTHETIC ─────────────────────────────
  // Issuer resolution rule (pure): explicit only if owned; single-company org
  // is unambiguous; multi-company org is left unresolved, never guessed.
  const orgCompanies = ["co-1", "co-2"];
  check("SYNTHETIC", "issuer: explicit company inside the org is accepted", pickIssuerCompanyId("co-1", orgCompanies) === "co-1");
  check("SYNTHETIC", "issuer: explicit company OUTSIDE the org is refused", pickIssuerCompanyId("co-x", orgCompanies) === null);
  check("SYNTHETIC", "issuer: single-company org resolves without guessing", pickIssuerCompanyId(null, ["co-1"]) === "co-1");
  check("SYNTHETIC", "issuer: multi-company org stays NULL (OWNERSHIP_UNKNOWN)", pickIssuerCompanyId(null, orgCompanies) === null);
  check("SYNTHETIC", "issuer: empty org stays NULL", pickIssuerCompanyId(null, []) === null);
  const fixtures: { label: string; row: Parameters<typeof decidePublication>[0]; state: string; matchable: boolean; evidence: string }[] = [
    { label: "open + priced → published", row: { is_open: true, user_id: "u1", prices: [380] }, state: "PUBLISHED", matchable: true, evidence: "USER_ACCOUNT" },
    { label: "closed + priced → unpublished", row: { is_open: false, user_id: "u1", prices: [380] }, state: "UNPUBLISHED", matchable: false, evidence: "USER_ACCOUNT" },
    { label: "deleted + open + priced → deleted", row: { deleted_at: "2026-10-01T00:00:00Z", is_open: true, user_id: "u1", prices: [380] }, state: "DELETED", matchable: false, evidence: "USER_ACCOUNT" },
    { label: "open without price → no price", row: { is_open: true, user_id: "u1", prices: [] }, state: "NO_PRICE", matchable: false, evidence: "USER_ACCOUNT" },
    { label: "zero/negative price → no price", row: { is_open: true, prices: [0, -5] }, state: "NO_PRICE", matchable: false, evidence: "NONE" },
    { label: "numeric string price accepted", row: { is_open: true, prices: ["380.50"] }, state: "PUBLISHED", matchable: true, evidence: "NONE" },
    { label: "NaN/blank price rejected", row: { is_open: true, prices: ["", null, "abc"] }, state: "NO_PRICE", matchable: false, evidence: "NONE" },
    { label: "line channel is evidence, not an owner account", row: { is_open: true, line_user_id: "U123", prices: [1] }, state: "PUBLISHED", matchable: true, evidence: "LINE_CHANNEL" },
    { label: "no identity → NONE", row: { is_open: true, prices: [1] }, state: "PUBLISHED", matchable: true, evidence: "NONE" },
  ];
  for (const f of fixtures) {
    const d = decidePublication(f.row);
    check("SYNTHETIC", f.label, d.state === f.state && d.matchable === f.matchable && d.owner_evidence === f.evidence, JSON.stringify(d));
    check("SYNTHETIC", `${f.label}: owner_verified stays false without a verification record`, d.owner_verified === false);
  }
  // The exact conflation this repair removes: is_open=true must NOT become "verified owner".
  const openNoOwner = decidePublication({ is_open: true, prices: [100] });
  check("SYNTHETIC", "is_open is not used as proof of ownership", openNoOwner.owner_verified === false && openNoOwner.owner_evidence === "NONE");
  check("SYNTHETIC", "a real verification record is required for owner_verified", decidePublication({ is_open: true, prices: [100], owner_verified_at: "2026-10-19T00:00:00Z" }).owner_verified === true);
  check("SYNTHETIC", "publicationState is the same single decision", publicationState({ is_open: true, prices: [1] }) === "PUBLISHED" && publicationState({ is_open: false, prices: [1] }) === "UNPUBLISHED");

  // ───────────────────────────── LIVE (read-only) ─────────────────────────────
  const db = supabaseAdmin();

  const before = await Promise.all([
    db.from("companies").select("id", { count: "exact", head: true }),
    db.from("pit_profiles").select("id", { count: "exact", head: true }),
    db.from("pit_materials").select("id", { count: "exact", head: true }),
    db.from("invoices").select("id", { count: "exact", head: true }),
  ]);
  const beforeCounts = before.map((r) => r.count ?? -1);

  const publicListing = await listPublicRegistry();
  check("LIVE", "public registry read succeeds", publicListing.ok === true, publicListing.error);
  const entries = (publicListing.entries ?? []) as Record<string, unknown>[];
  check("LIVE", "public registry entries expose no private fields", entries.every((e) => PRIVATE_KEYS.every((k) => !(k in e))), entries.length ? `keys=${Object.keys(entries[0]).join(",")}` : "no entries");
  check("LIVE", "public registry never claims a verified owner", entries.every((e) => e.owner_verified === false));
  check("LIVE", "every registry offer has a real price", entries.every((e) => e.publication_state !== "PUBLISHED" || (Array.isArray(e.available_materials) && (e.available_materials as { price: number }[]).every((m) => Number(m.price) > 0))));
  check("LIVE", "registry decision fields are present on every entry", entries.every((e) => typeof e.publication_state === "string" && typeof e.matchable === "boolean" && typeof e.owner_evidence === "string"));
  // Central data must still be searchable ACROSS suppliers — the boundary must
  // not collapse the marketplace into a single record.
  const publishedSites = new Set(entries.filter((e) => e.publication_state === "PUBLISHED").map((e) => String(e.site_name ?? "")));
  check("LIVE", "central registry still spans multiple published suppliers", publishedSites.size >= 2, `published_sites=${publishedSites.size}`);

  // Closed supply must not be matchable; a closed pit with real coords + priced
  // material is the exact leak the audit proved.
  const { data: closedPriced } = await db
    .from("pit_profiles")
    .select("id, latitude, longitude, is_open, deleted_at")
    .eq("is_open", false)
    .is("deleted_at", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .limit(50);
  const closedIds = new Set((closedPriced ?? []).map((p) => String(p.id)));
  const { data: pricedLinks } = await db.from("pit_materials").select("pit_profile_id, material_type_id, price").is("deleted_at", null).gt("price", 0);
  const linkByPit = new Map<string, string>();
  for (const l of pricedLinks ?? []) if (closedIds.has(String(l.pit_profile_id)) && !linkByPit.has(String(l.pit_profile_id))) linkByPit.set(String(l.pit_profile_id), String(l.material_type_id));
  const closedCandidate = (closedPriced ?? []).find((p) => linkByPit.has(String(p.id)));
  if (closedCandidate) {
    const nearest = await findNearestPit(Number(closedCandidate.latitude), Number(closedCandidate.longitude), linkByPit.get(String(closedCandidate.id)));
    check("LIVE", "closed pit is not returned by nearest-pit matching", nearest.nearest_pit?.id !== String(closedCandidate.id), nearest.nearest_pit ? `returned_state=${nearest.nearest_pit.publication_state}` : "no candidate");
    check("LIVE", "nearest-pit match is PUBLISHED", !nearest.nearest_pit || nearest.nearest_pit.publication_state === "PUBLISHED");
    check("LIVE", "nearest-pit match never reports a verified owner", !nearest.nearest_pit || nearest.nearest_pit.owner_verified === false);
  } else {
    check("LIVE", "closed priced pit fixture exists", false, "no closed pit with a priced material found");
  }

  // Deleted supply must not be returned either.
  const { data: deletedPits } = await db
    .from("pit_profiles")
    .select("id, latitude, longitude, deleted_at")
    .not("deleted_at", "is", null)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .limit(20);
  const deletedCandidate = (deletedPits ?? [])[0];
  if (deletedCandidate) {
    const nearest = await findNearestPit(Number(deletedCandidate.latitude), Number(deletedCandidate.longitude));
    check("LIVE", "deleted pit is not returned by nearest-pit matching", nearest.nearest_pit?.id !== String(deletedCandidate.id));
  } else {
    check("LIVE", "deleted pit fixture exists", false, "no deleted pit with coords found");
  }

  // Resource search used by the Sales AI: closed pits must be absent.
  const closedNames = new Set(
    ((await db.from("pit_profiles").select("pit_name").eq("is_open", false).is("deleted_at", null).ilike("pit_name", "%คอนกรีต%").limit(50)).data ?? [])
      .map((r) => String((r as { pit_name?: string }).pit_name ?? "")),
  );
  const publicSearch = await dispatch("pit.find", { keyword: "คอนกรีต" }, false);
  const publicHits = ((publicSearch.data ?? {}) as { hits?: { pit_name: string | null; is_open: boolean | null; price_min: number | null }[] }).hits ?? [];
  check("LIVE", "pit.find (external) succeeds", publicSearch.ok === true, publicSearch.violations?.join(" | "));
  check("LIVE", "pit.find (external) returns only open supply", publicHits.every((h) => h.is_open === true));
  check("LIVE", "pit.find (external) returns only priced supply", publicHits.every((h) => h.price_min != null && Number(h.price_min) > 0));
  check("LIVE", "pit.find (external) hides a known closed pit", !publicHits.some((h) => h.pit_name != null && closedNames.has(h.pit_name)));
  check("LIVE", "pit.find (external) declares PUBLISHED_ONLY", ((publicSearch.data ?? {}) as { publication_filter?: string }).publication_filter === "PUBLISHED_ONLY");

  const salesSearch = await dispatch("pit.find", { keyword: "คอนกรีต" }, false, { sandbox: "sales" });
  const salesHits = ((salesSearch.data ?? {}) as { hits?: { is_open: boolean | null }[] }).hits ?? [];
  check("LIVE", "pit.find (sales sandbox) returns only open supply", salesSearch.ok === true && salesHits.every((h) => h.is_open === true));

  const internalSearch = await dispatch("pit.find", { keyword: "คอนกรีต" }, false, { system: true });
  check("LIVE", "pit.find (trusted internal job) may read closed supply", ((internalSearch.data ?? {}) as { publication_filter?: string }).publication_filter === "INTERNAL_ALL", JSON.stringify(((internalSearch.data ?? {}) as { total?: number }).total ?? null));

  // Cross-tenant dispatcher gate still fails closed (no scope → no business read).
  const noScope = await dispatch("debt.list", {}, false);
  check("LIVE", "business reader without scope is denied", noScope.ok === false && noScope.violations.some((v) => v.includes("ORG_REQUIRED")));

  // Read-only proof: row counts are unchanged by this suite.
  const after = await Promise.all([
    db.from("companies").select("id", { count: "exact", head: true }),
    db.from("pit_profiles").select("id", { count: "exact", head: true }),
    db.from("pit_materials").select("id", { count: "exact", head: true }),
    db.from("invoices").select("id", { count: "exact", head: true }),
  ]);
  const afterCounts = after.map((r) => r.count ?? -1);
  check("LIVE", "no row count changed during the read-only suite", beforeCounts.every((n, i) => n === afterCounts[i]), `${beforeCounts.join(",")} → ${afterCounts.join(",")}`);

  // ───────────────────────────── report ─────────────────────────────
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  [${r.level}] ${r.label}${!r.ok && r.detail ? ` — ${r.detail}` : ""}`);
  }
  for (const level of ["STATIC", "SYNTHETIC", "LIVE"] as const) {
    const set = results.filter((r) => r.level === level);
    const passed = set.filter((r) => r.ok).length;
    console.log(`${level}: ${passed}/${set.length} PASS`);
  }
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
