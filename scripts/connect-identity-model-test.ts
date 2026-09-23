/**
 * Capability C (slice 1) — canonical Connect identity model test (2026-09-23).
 *
 * Proves, offline, that the canonical model exists and is the ONLY authority:
 *   C1  the migration creates the canonical tables + read view + credential accessor
 *   C2  the credential accessor is provider-NEUTRAL (no provider name, no branch)
 *   C3  the migration is additive only (never drops/renames a legacy table)
 *   C4  both legacy tables are marked HISTORICAL by the migration
 *   C5  the backfill is lossless + idempotent (COALESCE-preserving, ON CONFLICT)
 *   C6  credentials never enter the model (credential_ref is a reference)
 *   C7  the canonical resolvers do not read the legacy tables
 *   C8  the canonical model never exposes a credential to a client/UI caller
 *   C9  the accessor is service-role-only (revoked from anon/authenticated)
 *   C10 provider is a parameter everywhere (no provider-named API)
 *
 * The runtime/DB parity proof (backfill parity, idempotence, fail-closed accessor)
 * runs against a real local Postgres in /tmp/capC_identity_proof.sql +
 * /tmp/capC_accessor_proof.sql; this file guards the source invariants so those
 * proofs cannot silently stop being true.
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

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

const MIGRATION = "supabase/migrations/20260923000003_connect_external_identity.sql";
const NEXT_ENGINE = "engines/connect/identity.ts";
const NEXT_ACCOUNTS = "engines/connect/accounts.ts";
const DENO_HELPER = "supabase/functions/_shared/connect-identity.ts";

check("C1 migration exists", existsSync(join(ROOT, MIGRATION)));
const migration = read(MIGRATION);

// C1 — the canonical model
check("C1 creates the account registry", migration.includes("create table if not exists public.connect_external_accounts"));
check("C1 creates the identity table", migration.includes("create table if not exists public.connect_external_identities"));
check("C1 creates the canonical read view", migration.includes("create view public.connect_identity_current"));
check("C1 creates the credential accessor", migration.includes("create or replace function public.connect_external_account_credentials"));
check("C1 identity is unique per (provider, subject)", /unique \(provider, external_subject_id\)/.test(migration));

// C2 — the accessor must not know any provider
const fnBody = migration.slice(
  migration.indexOf("create or replace function public.connect_external_account_credentials"),
  migration.indexOf("comment on function public.connect_external_account_credentials"),
);
check("C2 accessor contains no provider name", !/line/i.test(fnBody), (fnBody.match(/line/gi) ?? []).join(","));
check("C2 accessor derives the source from credential_ref", fnBody.includes("credential_ref") && fnBody.includes("split_part"));
check("C2 accessor validates identifiers against information_schema", fnBody.includes("information_schema.columns"));

// C3 — additive only
const ddl = migration.replace(/--[^\n]*/g, "");
check("C3 never drops a table", !/drop table/i.test(ddl));
check("C3 never renames a table", !/alter table[^;]*rename/i.test(ddl));
// deletes are allowed ONLY as keyed projection mirrors (inside the projection
// function) — a table-wide delete or a truncate would be real data loss
check("C3 no table-wide delete or truncate of a legacy table", !/truncate\s+table|delete from public\.(line_profiles|company_line_links|line_channels)\s*;/i.test(ddl));
const projectionFn = migration.slice(
  migration.indexOf("create or replace function public.connect_project_identity_to_legacy"),
  migration.indexOf("-- Guard: the legacy tables are projections"),
);
const deletesOutsideProjection = (migration.match(/delete from public\.(line_profiles|company_line_links)[^;]*;/gi) ?? [])
  .filter((stmt) => !projectionFn.includes(stmt));
check("C3 every legacy delete is the keyed projection mirror", deletesOutsideProjection.length === 0, deletesOutsideProjection.join(" | "));

// C4 — legacy tables marked historical
check("C4 line_profiles marked HISTORICAL", /comment on table public\.line_profiles[^;]*HISTORICAL/.test(migration));
check("C4 company_line_links marked HISTORICAL", /comment on table public\.company_line_links[^;]*HISTORICAL/.test(migration));

// C5 — lossless + idempotent backfill
check("C5 backfill uses ON CONFLICT upsert", migration.includes("on conflict (provider, external_subject_id) do update"));
check("C5 backfill preserves existing values (COALESCE)", /set company_id\s*=\s*coalesce\(/i.test(migration));
check("C5 backfill unions both legacy sources", migration.includes("from public.company_line_links") && migration.includes("from public.line_profiles"));
check("C5 backfill registers legacy channels as accounts", migration.includes("from public.line_channels"));

// C6 — no credential value in the model
check("C6 account table holds a reference, not a value", migration.includes("credential_ref      text") && !/channel_secret\s+text/.test(migration));
check("C6 credential_ref points at the existing provider config", migration.includes("'line_channels:channel_secret,channel_access_token'"));

// C9 — access control
check("C9 accessor revoked from anon", /revoke all on function public\.connect_external_account_credentials\(text, text\) from anon/.test(migration));
check("C9 accessor revoked from authenticated", /revoke all on function public\.connect_external_account_credentials\(text, text\) from authenticated/.test(migration));
check("C9 accessor granted to service_role only", /grant execute on function public\.connect_external_account_credentials\(text, text\) to service_role/.test(migration));
check("C9 RLS enabled on both canonical tables", (migration.match(/enable row level security/g) ?? []).length >= 2);
check("C9 view revoked from anon/authenticated", migration.includes("revoke all on public.connect_identity_current from anon"));

// C7/C10 — resolvers never touch the legacy tables in CODE (comments may name them)
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
for (const rel of [NEXT_ENGINE, NEXT_ACCOUNTS, DENO_HELPER]) {
  const src = read(rel);
  check(`C7 ${rel} never reads a legacy identity table`, !/line_profiles|company_line_links|line_channels/.test(stripComments(src)), "legacy table referenced in code");
  check(`C10 ${rel} takes provider as a parameter`, /provider/.test(src));
}
check("C7 Next resolver reads the canonical view only", /VIEW\s*=\s*"connect_identity_current"/.test(read(NEXT_ENGINE)));
check("C7 Deno helper reads the canonical view", read(DENO_HELPER).includes('from("connect_identity_current")'));
check("C7 canonical writer targets the canonical table", read(NEXT_ENGINE).includes('from("connect_external_identities")'));
check("C8 credential accessor documented server-only", /never by a client component/.test(read(NEXT_ACCOUNTS)));
check("C8 no client component in the connect engines", !/^"use client"/m.test(read(NEXT_ACCOUNTS) + read(NEXT_ENGINE)));

// C11/C12/C13 — single authority: canonical writes, legacy tables read-only
check("C11 projection function exists", migration.includes("create or replace function public.connect_project_identity_to_legacy()"));
check("C11 projection mirrors line_profiles", migration.includes("insert into public.line_profiles"));
check("C11 projection mirrors company_line_links", migration.includes("insert into public.company_line_links"));
check("C12 guard function rejects direct writes", /raise exception[^;]*read-only projection/.test(migration));
check("C12 guard lets the projection itself through (trigger depth)", /pg_trigger_depth\(\) > 1/.test(migration));
check("C13 projection triggers installed (insert/update + delete)", migration.includes("connect_project_identity_ins") && migration.includes("connect_project_identity_del"));
check("C13 guard triggers installed on both legacy tables", (migration.match(/create trigger connect_identity_legacy_guard/g) ?? []).length === 2);

// C14 — the two real writers now go through the canonical writer
const WRITER_PROFILE = "app/api/admin/line-profiles/[lineUserId]/route.ts";
const WRITER_MATCH = "app/api/admin/relationships/[relationshipId]/match/route.ts";
for (const rel of [WRITER_PROFILE, WRITER_MATCH]) {
  const code = stripComments(read(rel));
  check(`C14 ${rel} writes through the canonical writer`, code.includes("linkExternalIdentity("));
  check(`C14 ${rel} no longer writes a legacy identity table`, !/\.from\("line_profiles"\)[\s\S]{0,80}\.upsert\(/.test(code) && !/\.from\("company_line_links"\)[\s\S]{0,80}\.insert\(/.test(code));
}

// C15 — multi-storefront: per-account resolution, no single env var authority
const webhook = stripComments(read("supabase/functions/line-webhook-v2/index.ts"));
check("C15 webhook resolves the account through the canonical accessor", webhook.includes("resolveAccountCredential("));
check("C15 webhook no longer reads the provider config table directly", !/\.from\("line_channels"\)/.test(webhook));
check("C15 webhook keeps the main account env fallback", webhook.includes("LINE_CHANNEL_SECRET"));

// C16 — single canonical writer (census)
const canonicalWriters: string[] = [];
const walk2 = (relDir: string): void => {
  for (const entry of readdirSync(join(ROOT, relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk2(rel);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const code = stripComments(read(rel));
    if (/\.from\("connect_external_identities"\)[\s\S]{0,80}\.upsert\(/.test(code)) canonicalWriters.push(rel);
  }
};
for (const dir of ["app", "core", "engines", "services", "gateway"]) walk2(dir);
check("C16 exactly one canonical identity writer exists", canonicalWriters.length === 1, canonicalWriters.join(","));
check("C16 that writer is the Connect engine", canonicalWriters[0] === NEXT_ENGINE, canonicalWriters[0]);

// C18 — no credential value reaches app/ui code
const credentialLeaks: string[] = [];
const walk3 = (relDir: string): void => {
  for (const entry of readdirSync(join(ROOT, relDir), { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk3(rel);
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
    if (stripComments(read(rel)).includes("line_channels")) credentialLeaks.push(rel);
  }
};
for (const dir of ["app", "presentation", "engines", "services"]) walk3(dir);
check("C18 no app/UI code reads the provider credential table", credentialLeaks.length === 0, credentialLeaks.join(","));

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) {
  console.log(`${failures} FAILED`);
  process.exit(1);
}

