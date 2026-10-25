/**
 * READ-ONLY probe — Super Admin / Owner permission audit (2026-10-25)
 *
 * Safety contract (identical to the other read-only probes in this folder):
 *   · HTTP GET only (PostgREST + GoTrue admin read). No writes, no RPC, no DDL.
 *   · service-role key read from the Supabase CLI in memory; never printed.
 *   · Output = role/membership/count facts with masked account hashes. No
 *     emails, names, tokens, or business row contents.
 *
 * Usage: node scripts/permission-audit-readonly-probe.mjs [--json out.json]
 */
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";

const PROJECT_REF = "xeytcavxejhyzxwevgto";

function serviceKey() {
  const raw = execFileSync(
    "npx",
    ["supabase", "projects", "api-keys", "--project-ref", PROJECT_REF, "--output", "json"],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const row = JSON.parse(raw).find((k) => String(k.description ?? "").toLowerCase().includes("service_role"));
  if (!row?.api_key) throw new Error("service_role key not returned by CLI");
  return row.api_key;
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
const BASE = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "");
const H = { apikey: serviceKey(), Authorization: "" };
H.Authorization = `Bearer ${H.apikey}`;

const mask = (id) => (id ? `acct_${createHash("sha256").update(String(id)).digest("hex").slice(0, 8)}` : null);
const maskActor = (v) => (typeof v === "string" && v.includes("@") ? "owner-account" : v);
const get = async (p) => {
  const r = await fetch(`${BASE}${p}`, { headers: H });
  return r.ok ? r.json() : { __err: r.status, __path: p };
};
const out = { generated_at: new Date().toISOString(), project_ref: PROJECT_REF };

// ── schema facts that decide whether a role can mean anything ──────────────
{
  const spec = await get("/rest/v1/");
  const d = spec.definitions ?? {};
  out.schema = {
    table_count: Object.keys(d).length,
    has_authority_grants: Object.keys(d).includes("authority_grants"),
    has_org_members: Object.keys(d).includes("org_members"),
    org_members_columns: Object.keys(d.org_members?.properties ?? {}),
    organizations_columns: Object.keys(d.organizations?.properties ?? {}),
    has_admin_session: Object.keys(d).includes("admin_session"),
    has_identity_memberships: Object.keys(d).includes("identity_memberships"),
  };
}

// ── the 3 accounts and their role provenance ──────────────────────────────
{
  const users = await get("/auth/v1/admin/users?per_page=200");
  const list = users?.users ?? [];
  const profiles = await get("/rest/v1/profiles?select=id,role,created_at,updated_at&limit=10");
  out.accounts = {
    auth_users: list.length,
    users: list.map((u) => ({
      account: mask(u.id),
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      email_confirmed: Boolean(u.email_confirmed_at || u.confirmed_at),
      provider: u.app_metadata?.provider ?? null,
      email_domain: String(u.email ?? "").split("@")[1] ?? null,
    })),
    profiles: Array.isArray(profiles)
      ? profiles.map((p) => ({
          account: mask(p.id),
          role: p.role,
          created_at: p.created_at,
          updated_at: p.updated_at,
          role_changed_after_creation: p.updated_at !== p.created_at,
        }))
      : profiles,
  };
  const byCreated = (out.accounts.profiles ?? []).slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  out.accounts.earliest_profile = byCreated[0] ?? null;
}

// ── organisation layer (the only real "owner" concept in the DB) ──────────
{
  const orgs = await get("/rest/v1/organizations?select=id,created_by,created_at&limit=10");
  const members = await get("/rest/v1/org_members?select=user_id,organization_id,role,created_at&limit=20");
  out.organisation = {
    organizations: Array.isArray(orgs) ? orgs.map((o) => ({ created_by: mask(o.created_by), created_at: o.created_at })) : orgs,
    members: Array.isArray(members) ? members.map((m) => ({ account: mask(m.user_id), role: m.role, added_at: m.created_at })) : members,
  };
}

// ── identity layer (separate namespace from profiles) ─────────────────────
{
  const idm = await get("/rest/v1/identity_memberships?select=account_id,role,world,revoked_at&limit=20");
  out.identity_layer = Array.isArray(idm)
    ? idm.map((i) => ({ account: mask(i.account_id), role: i.role, world: i.world, revoked: Boolean(i.revoked_at) }))
    : idm;
}

// ── is any role change/assignment recorded as evidence? ───────────────────
{
  const roleRows = await get("/rest/v1/audit_logs?select=actor_user_id,entity_type,action,created_at&or=(entity_type.ilike.*profile*,action.ilike.*role*)&limit=100");
  const adminLogins = await get("/rest/v1/audit_logs?select=actor_user_id,action,created_at&action=eq.ADMIN_LOGIN&limit=100");
  const ownerAuth = await get("/rest/v1/owner_auth_audit_log?select=*&limit=5");
  out.evidence_of_role_admin = {
    role_or_profile_audit_rows: Array.isArray(roleRows) ? roleRows.length : roleRows,
    role_audit_sample: Array.isArray(roleRows) ? roleRows.slice(0, 10).map((r) => ({ account: mask(r.actor_user_id), entity: r.entity_type, action: r.action })) : roleRows,
    admin_login_rows: Array.isArray(adminLogins) ? adminLogins.length : adminLogins,
    admin_login_attributed: Array.isArray(adminLogins) ? adminLogins.filter((r) => r.actor_user_id).length : null,
    owner_auth_audit_rows: Array.isArray(ownerAuth) ? ownerAuth.length : ownerAuth,
  };
}

// ── "developer" actors that live outside the user role namespace ──────────
{
  const locks = await get("/rest/v1/workspace_locks?select=holder_actor,released_at&limit=100");
  const devLoop = await get("/rest/v1/dev_loop_sessions?select=owner,status&limit=100");
  const scanRuns = await get("/rest/v1/storage_scan_runs?select=actor&limit=100");
  const group = (arr, pick) => {
    const m = {};
    for (const r of arr) {
      const k = String(pick(r) ?? "null");
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  };
  out.developer_actor_namespaces = {
    workspace_locks: Array.isArray(locks) ? { rows: locks.length, holders: group(locks, (l) => maskActor(l.holder_actor)) } : locks,
    dev_loop_sessions: Array.isArray(devLoop) ? { rows: devLoop.length, owners: group(devLoop, (d) => maskActor(d.owner)) } : devLoop,
    storage_scan_runs: Array.isArray(scanRuns) ? { rows: scanRuns.length, actors: group(scanRuns, (s) => maskActor(s.actor)) } : scanRuns,
  };
}

// ── external accounts (connectors) — provider + state only, no credentials ─
{
  const conn = await get("/rest/v1/connectors?select=slug,auth_type,status,enabled,created_by_admin_id,last_checked_at&limit=20");
  out.connectors = Array.isArray(conn)
    ? { rows: conn.length, items: conn.map((c) => ({ slug: c.slug, auth_type: c.auth_type, status: c.status, enabled: c.enabled, created_by: mask(c.created_by_admin_id) })) }
    : conn;
}

// ── API tokens: how many cross-system read credentials exist ──────────────
{
  const t = await get("/rest/v1/api_tokens?select=scopes,last_used_at,revoked_at,user_email,created_at&limit=20");
  out.api_tokens = Array.isArray(t)
    ? {
        rows: t.length,
        active: t.filter((x) => !x.revoked_at).length,
        scopes: [...new Set(t.map((x) => JSON.stringify(x.scopes)))],
        email_domains: [...new Set(t.map((x) => String(x.user_email ?? "").split("@")[1] ?? "null"))],
        last_used_at: t.map((x) => x.last_used_at).filter(Boolean).sort().slice(-1)[0] ?? null,
      }
    : t;
}

// ── anon visibility (RLS proof, no data read) ─────────────────────────────
{
  const anon = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` };
  const tables = ["profiles", "companies", "org_members", "organizations", "audit_logs", "api_tokens", "connectors", "workspace_locks", "dev_loop_sessions"];
  out.anon_rls = {};
  for (const table of tables) {
    const r = await fetch(`${BASE}/rest/v1/${table}?select=*&limit=1`, { method: "HEAD", headers: { ...anon, Prefer: "count=exact", Range: "0-0" } });
    out.anon_rls[table] = `${r.status} ${r.headers.get("content-range") ?? ""}`.trim();
  }
}

const flag = process.argv.indexOf("--json");
if (flag >= 0 && process.argv[flag + 1]) writeFileSync(process.argv[flag + 1], JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
