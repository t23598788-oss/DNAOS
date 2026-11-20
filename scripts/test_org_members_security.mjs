import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const status = spawnSync("supabase", ["status", "--workdir", ".", "--output", "env"], { encoding: "utf8" });
assert.equal(status.status, 0, `Supabase Local status failed: ${status.stderr}`);
const values = Object.fromEntries(status.stdout.split(/\r?\n/).flatMap(line => {
  const i = line.indexOf("=");
  if (i < 1) return [];
  let value = line.slice(i + 1).trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
  return [[line.slice(0, i), value]];
}));
const apiUrl = new URL(values.API_URL);
const dbUrl = new URL(values.DB_URL);
assert.ok(["127.0.0.1", "localhost"].includes(apiUrl.hostname), "refusing non-local Supabase API");
assert.ok(["127.0.0.1", "localhost"].includes(dbUrl.hostname), "refusing non-local PostgreSQL");
const anonKey = values.ANON_KEY;
const serviceKey = values.SERVICE_ROLE_KEY;
assert.ok(anonKey && serviceKey, "Local Supabase keys are required");

const psqlEnv = {
  ...process.env,
  PGHOST: dbUrl.hostname,
  PGPORT: dbUrl.port || "5432",
  PGUSER: decodeURIComponent(dbUrl.username),
  PGPASSWORD: decodeURIComponent(dbUrl.password),
  PGDATABASE: dbUrl.pathname.slice(1),
};
const users = [];
const organizations = [];
const password = `Local-Membership-${crypto.randomUUID()}!`;
const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

async function request(path, { method = "GET", token, admin = false, body, headers = {} } = {}) {
  const response = await fetch(`${values.API_URL}${path}`, {
    method,
    headers: {
      apikey: admin ? serviceKey : anonKey,
      ...(token ? { authorization: `Bearer ${token}` } : admin ? { authorization: `Bearer ${serviceKey}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { response, payload };
}

async function createUser(label) {
  const email = `org-security-${label}-${suffix}@example.test`;
  const created = await request("/auth/v1/admin/users", {
    method: "POST", admin: true, body: { email, password, email_confirm: true },
  });
  assert.equal(created.response.status, 200, `Local auth fixture creation failed (${label}): ${created.response.status}`);
  const id = created.payload.id;
  users.push(id);
  const signed = await request("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
  assert.equal(signed.response.status, 200, `Local authenticated sign-in failed (${label}): ${signed.response.status}`);
  return { id, token: signed.payload.access_token };
}

async function onboard(owner, label) {
  const result = await request("/rest/v1/rpc/onboard_business", {
    method: "POST", token: owner.token,
    body: { p_user_id: owner.id, p_shop_name: `Org Security ${label}`, p_lat: 13.75, p_lng: 100.5 },
  });
  assert.equal(result.response.status, 200, `Existing onboard_business failed for ${label}: ${JSON.stringify(result.payload)}`);
  organizations.push(result.payload.organization_id);
  const member = await request(`/rest/v1/org_members?organization_id=eq.${result.payload.organization_id}&user_id=eq.${owner.id}&select=role`, { token: owner.token });
  assert.equal(member.response.status, 200, `membership read after onboard failed: ${JSON.stringify(member.payload)}`);
  assert.equal(member.payload[0]?.role, "owner", "onboard_business must keep creating the caller as owner");
  return result.payload.organization_id;
}

async function manage(actor, orgId, targetId, action, role) {
  return request("/rest/v1/rpc/manage_org_member", {
    method: "POST", token: actor.token,
    body: { p_org_id: orgId, p_target_user_id: targetId, p_action: action, ...(role === undefined ? {} : { p_role: role }) },
  });
}

function assertDenied(result, label) {
  assert.ok(result.response.status >= 400, `${label} unexpectedly succeeded: ${JSON.stringify(result.payload)}`);
}
function assertAllowed(result, label) {
  assert.equal(result.response.status, 200, `${label} failed (${result.response.status}): ${JSON.stringify(result.payload)}`);
}

function catalogAssertions() {
  const sql = `select p.prosecdef::text || '|' || has_function_privilege('anon',p.oid,'EXECUTE')::text || '|' || has_function_privilege('authenticated',p.oid,'EXECUTE')::text || '|' || has_function_privilege('service_role',p.oid,'EXECUTE')::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='manage_org_member';
select p.prosecdef::text || '|' || has_function_privilege('authenticated',p.oid,'EXECUTE')::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='onboard_business';
select has_table_privilege('anon','public.org_members','INSERT')::text || '|' || has_table_privilege('authenticated','public.org_members','INSERT')::text || '|' || has_table_privilege('authenticated','public.org_members','UPDATE')::text || '|' || has_table_privilege('authenticated','public.org_members','DELETE')::text;`;
  const result = spawnSync("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", env: psqlEnv });
  assert.equal(result.status, 0, `Local catalog assertions failed: ${result.stderr}`);
  const rows = result.stdout.trim().split(/\r?\n/);
  assert.equal(rows[0], "true|false|true|false", "manage_org_member must be SECURITY DEFINER, executable by authenticated only");
  assert.equal(rows[1], "true|true", "onboard_business SECURITY DEFINER / authenticated EXECUTE must remain intact");
  assert.equal(rows[2], "false|false|false|false", "direct membership DML must be revoked from anon/authenticated");
}

try {
  catalogAssertions();
  const ownerA = await createUser("owner-a");
  const ownerB = await createUser("owner-b");
  const userC = await createUser("user-c");
  const userD = await createUser("user-d");
  const orgA = await onboard(ownerA, "A");
  const orgB = await onboard(ownerB, "B");

  // Direct PostgREST writes are denied even to a legitimate owner.
  const directInsert = await request("/rest/v1/org_members", {
    method: "POST", token: ownerA.token,
    body: { organization_id: orgA, user_id: userD.id, role: "member" },
    headers: { prefer: "return=minimal" },
  });
  assertDenied(directInsert, "authenticated direct INSERT");
  const directUpdate = await request(`/rest/v1/org_members?organization_id=eq.${orgA}&user_id=eq.${ownerA.id}`, {
    method: "PATCH", token: ownerA.token, body: { role: "member" }, headers: { prefer: "return=minimal" },
  });
  assertDenied(directUpdate, "authenticated direct UPDATE");
  const directDelete = await request(`/rest/v1/org_members?organization_id=eq.${orgA}&user_id=eq.${ownerA.id}`, {
    method: "DELETE", token: ownerA.token, headers: { prefer: "return=minimal" },
  });
  assertDenied(directDelete, "authenticated direct DELETE");

  assertDenied(await manage(ownerA, orgB, userD.id, "ADD", "member"), "cross-organization add");
  assertDenied(await manage(ownerA, orgA, userD.id, "ADD", "owner"), "owner role assignment");
  assertAllowed(await manage(ownerA, orgA, userC.id, "ADD", "admin"), "owner adds admin in own organization");
  assertAllowed(await manage(userC, orgA, userD.id, "ADD", "member"), "admin adds member in own organization");
  const adminRoster = await request(`/rest/v1/org_members?organization_id=eq.${orgA}&select=user_id,role`, { token: userC.token });
  assert.equal(adminRoster.response.status, 200);
  assert.equal(adminRoster.payload.length, 3, "organization admin must see the full roster for that organization");
  assertAllowed(await manage(ownerA, orgA, userD.id, "SET_ROLE", "admin"), "owner promotes member to admin");
  assertAllowed(await manage(ownerA, orgA, userD.id, "SET_ROLE", "member"), "owner demotes admin to member");
  assertDenied(await manage(userC, orgA, userD.id, "SET_ROLE", "admin"), "admin escalates member to admin");
  assertDenied(await manage(userC, orgA, userD.id, "ADD", "admin"), "admin grants admin");
  assertDenied(await manage(userC, orgA, ownerA.id, "REMOVE"), "admin removes owner");
  assertAllowed(await manage(ownerA, orgA, userD.id, "REMOVE"), "owner revokes member");
  assertAllowed(await manage(ownerB, orgB, userC.id, "ADD", "member"), "second organization adds same user as member");
  const memberRoster = await request(`/rest/v1/org_members?organization_id=eq.${orgB}&select=user_id,role`, { token: userC.token });
  assert.equal(memberRoster.response.status, 200);
  assert.deepEqual(memberRoster.payload.map(row => row.user_id), [userC.id], "ordinary member sees only their own membership row");
  const dualMemberships = await request(`/rest/v1/org_members?user_id=eq.${userC.id}&select=organization_id,role`, { token: userC.token });
  assert.equal(dualMemberships.response.status, 200);
  assert.deepEqual(new Set(dualMemberships.payload.map(row => row.organization_id)), new Set([orgA, orgB]),
    "one authenticated account must hold memberships in two organizations concurrently");
  assertAllowed(await manage(ownerA, orgA, userC.id, "REMOVE"), "owner revokes admin");
  const hiddenOrgA = await request(`/rest/v1/organizations?id=eq.${orgA}&select=id`, { token: userC.token });
  assert.equal(hiddenOrgA.response.status, 200);
  assert.equal(hiddenOrgA.payload.length, 0, "revoked user must lose organization visibility");
  const visibleOrgB = await request(`/rest/v1/organizations?id=eq.${orgB}&select=id`, { token: userC.token });
  assert.equal(visibleOrgB.response.status, 200);
  assert.equal(visibleOrgB.payload.length, 1, "revoking one organization must retain the other membership");
  assertDenied(await manage(userC, orgB, userD.id, "ADD", "member"), "member manages organization membership");
  assertDenied(await manage(ownerB, orgB, ownerB.id, "REMOVE"), "last owner removal");
  const stillOwner = await request(`/rest/v1/org_members?organization_id=eq.${orgB}&user_id=eq.${ownerB.id}&select=role`, { token: ownerB.token });
  assert.equal(stillOwner.response.status, 200);
  assert.equal(stillOwner.payload[0]?.role, "owner", "last owner remains after rejected removal");
  assertAllowed(await manage(ownerB, orgB, userC.id, "REMOVE"), "second organization revokes member");
  const hiddenOrgB = await request(`/rest/v1/organizations?id=eq.${orgB}&select=id`, { token: userC.token });
  assert.equal(hiddenOrgB.response.status, 200);
  assert.equal(hiddenOrgB.payload.length, 0, "revoked membership must lose second organization visibility");

  console.log(JSON.stringify({ result: "PASS", scope: "Supabase Local only", checks: [
    "existing onboard_business creates caller as owner",
    "authenticated direct INSERT/UPDATE/DELETE denied",
    "cross-organization membership change denied",
    "owner can add admin/member in own organization",
    "admin sees only the full roster of their authorized organization",
    "ordinary member sees only their own membership row",
    "admin can add member only",
    "owner can change member/admin roles",
    "admin escalation and owner assignment denied",
    "admin cannot remove owner",
    "owner can revoke member/admin",
    "revoked membership loses organization visibility",
    "member cannot manage membership",
    "last owner removal denied",
    "one user can be a member of two organizations",
    "SECURITY DEFINER and RPC EXECUTE grants verified",
  ] }, null, 2));
} finally {
  if (organizations.length || users.length) {
    const orgArray = organizations.length ? `array[${organizations.map(id => `'${id.replace(/[^0-9a-f-]/gi, "")}'`).join(",")}]::uuid[]` : "array[]::uuid[]";
    const userArray = users.length ? `array[${users.map(id => `'${id.replace(/[^0-9a-f-]/gi, "")}'`).join(",")}]::uuid[]` : "array[]::uuid[]";
    const cleanupSql = `begin;
      delete from public.business_locations where organization_id = any(${orgArray});
      delete from public.platform_quotas where organization_id = any(${orgArray});
      delete from public.business_profiles where company_id in (select id from public.companies where organization_id = any(${orgArray}));
      delete from public.companies where organization_id = any(${orgArray});
      delete from public.organizations where id = any(${orgArray});
      delete from auth.users where id = any(${userArray});
      commit;`;
    const cleanup = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-c", cleanupSql], { encoding: "utf8", env: psqlEnv });
    if (cleanup.status !== 0) console.error(`Local-only fixture cleanup failed: ${cleanup.stderr}`);
  }
}
