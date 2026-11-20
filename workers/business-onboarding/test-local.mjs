import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import worker from "./index.ts";

const status = spawnSync("supabase", ["status", "--workdir", "../../", "--output", "env"], {
  cwd: fileURLToPath(new URL(".", import.meta.url)), encoding: "utf8",
});
assert.equal(status.status, 0, "Supabase Local must be running before this test.");
const statusText = status.stdout;
const values = Object.fromEntries(statusText.split(/\r?\n/).flatMap(line => {
  const at = line.indexOf("=");
  if (at < 1) return [];
  const key = line.slice(0, at); let value = line.slice(at + 1).trim();
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
  return [[key, value]];
}));
const supabaseUrl = values.API_URL;
const anonKey = values.ANON_KEY;
const serviceKey = values.SERVICE_ROLE_KEY;
const dbUrl = values.DB_URL;
assert(supabaseUrl && anonKey && serviceKey && dbUrl, "Local Supabase must be running; no credentials are printed by this test.");
const encryptionKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const databaseUrl = new URL(dbUrl);
const psqlEnv = {
  ...process.env,
  PGHOST: databaseUrl.hostname,
  PGPORT: databaseUrl.port || "5432",
  PGUSER: decodeURIComponent(databaseUrl.username),
  PGPASSWORD: decodeURIComponent(databaseUrl.password),
  PGDATABASE: databaseUrl.pathname.slice(1),
};

const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const emailA = `onboarding-a-${suffix}@example.test`;
const emailB = `onboarding-b-${suffix}@example.test`;
const password = `Local-Test-${crypto.randomUUID()}!`;
const createdUsers = [];
let companyId;
let secondCompanyId;
let organizationId;
let buyerOrganizationId;
const uploadedLegalPaths = [];

async function request(path, { method = "GET", token, body, admin = false, schema } = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      apikey: admin ? serviceKey : anonKey,
      ...(token ? { authorization: `Bearer ${token}` } : admin ? { authorization: `Bearer ${serviceKey}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...(schema ? { "content-profile": schema, "accept-profile": schema } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { response, payload };
}

async function makeUser(email) {
  const created = await request("/auth/v1/admin/users", {
    method: "POST", admin: true, body: { email, password, email_confirm: true },
  });
  assert.equal(created.response.status, 200, `create local test auth user: ${created.response.status}`);
  const userId = created.payload.id;
  createdUsers.push(userId);
  const signed = await request("/auth/v1/token?grant_type=password", {
    method: "POST", body: { email, password },
  });
  assert.equal(signed.response.status, 200, `sign in local test user: ${signed.response.status}`);
  return { id: userId, token: signed.payload.access_token };
}

async function callWorker(path, { token, body, headers = {} } = {}) {
  return worker.fetch(new Request(`http://local.test${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), { SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey, ERP_CREDENTIALS_ENCRYPTION_KEY: encryptionKey });
}

function runSqlAssertions(userId) {
  const sqlTest = new URL("../../scripts/test_business_onboarding.sql", import.meta.url);
  const result = spawnSync("psql", ["-v", `test_user_id=${userId}`, "-v", "ON_ERROR_STOP=1", "-f", sqlTest.pathname], {
    encoding: "utf8", env: psqlEnv,
  });
  assert.equal(result.status, 0, `SQL assertions failed: ${result.stderr}`);
}

function runSqlFixture(userId, path) {
  const result = spawnSync("psql", ["-v", `test_user_id=${userId}`, "-v", "ON_ERROR_STOP=1", "-f", new URL(path, import.meta.url).pathname], {
    encoding: "utf8", env: psqlEnv,
  });
  assert.equal(result.status, 0, `Local identity fixtures failed: ${result.stderr}`);
}

function runSqlQuery(sql) {
  const args = ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1"];
  args.push("-c", sql);
  const result = spawnSync("psql", args, { encoding: "utf8", env: psqlEnv });
  assert.equal(result.status, 0, `Local SQL query failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function uploadLegalFile(userIdToken, orgId, fileName, contents) {
  const objectPath = `${orgId}/${crypto.randomUUID()}-${fileName}`;
  const response = await fetch(`${supabaseUrl}/storage/v1/object/org-legal-documents/${objectPath}`, {
    method: "POST",
    headers: { apikey: anonKey, authorization: `Bearer ${userIdToken}`, "content-type": "application/pdf", "x-upsert": "false" },
    body: contents,
  });
  assert.equal(response.status, 200, `private legal document upload denied: ${response.status} ${await response.text()}`);
  uploadedLegalPaths.push(objectPath);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", contents));
  return { storage_object_path: objectPath, file_sha256: [...hash].map(byte => byte.toString(16).padStart(2, "0")).join(""),
    file_name: fileName, mime_type: "application/pdf", file_size_bytes: contents.length };
}

try {
  const health = await callWorker("/health");
  assert.equal(health.status, 200);
  const unauth = await callWorker("/v1/tools/report_business_quotas", { body: { company_id: crypto.randomUUID() } });
  assert.equal(unauth.status, 401, "unauthenticated calls must fail closed");

  const userA = await makeUser(emailA);
  const userB = await makeUser(emailB);
  const spoof = await callWorker("/v1/tools/onboard_business", {
    token: userA.token, body: { user_id: userB.id, shop_name: "ร้านปลอม", lat: 13.75, lng: 100.5 },
  });
  assert.equal(spoof.status, 400, "model supplied user identity must be rejected");

  const onboard = await callWorker("/v1/tools/onboard_business", {
    token: userA.token, body: { shop_name: "ร้านขายอิฐทดสอบ", lat: 13.7563, lng: 100.5018 },
  });
  assert.equal(onboard.status, 200, `onboarding failed: ${JSON.stringify(await onboard.clone().json())}`);
  const onboardJson = await onboard.json();
  companyId = onboardJson.data.company_id;
  organizationId = onboardJson.data.organization_id;
  assert.equal(onboardJson.data.quotas.documents, 10);
  assert.equal(onboardJson.data.quotas.ai_interview_turns, 20);
  assert.equal(onboardJson.data.quotas.business_locations, 1);
  runSqlAssertions(userA.id);
  runSqlFixture(userA.id, "../../scripts/prepare_local_identity_fixtures.sql");

  const identity = await callWorker("/v1/secure/business/identity", {
    token: userA.token,
    body: { org_id: organizationId, company_id: companyId, entity_type: "JURISTIC", operation_type: "MANUFACTURER",
      registration_no: "LOCAL-TEST-0001", tax_id: "0000000000000", registered_capital: 5000000 },
  });
  assert.equal(identity.status, 200, `business identity registration failed: ${JSON.stringify(await identity.clone().json())}`);
  const identitySummary = await request(`/rest/v1/business_profiles?company_id=eq.${companyId}&select=entity_type,operation_type,commercial_registration_no,registered_capital,legal_status`, { token: userA.token });
  assert.equal(identitySummary.response.status, 200);
  assert.equal(identitySummary.payload[0].entity_type, "JURISTIC");
  assert.equal(identitySummary.payload[0].operation_type, "MANUFACTURER");
  assert.equal(identitySummary.payload[0].legal_status, "PENDING");

  const registrationPdf = new Uint8Array(Buffer.from("%PDF-1.4\nLOCAL FIXTURE registration\n%%EOF"));
  const registrationFile = await uploadLegalFile(userA.token, organizationId, "registration.pdf", registrationPdf);
  const forbiddenFileRead = await fetch(`${supabaseUrl}/storage/v1/object/org-legal-documents/${registrationFile.storage_object_path}`, {
    headers: { apikey: anonKey, authorization: `Bearer ${userB.token}` },
  });
  assert.ok(!forbiddenFileRead.ok, "another organization must not download private legal files");
  const tamperedHash = await callWorker("/v1/tools/submit_identity_documents", {
    token: userA.token, body: { org_id: organizationId, documents: [
      { document_code: "TEST_REGISTRATION_CERT", ...registrationFile, file_sha256: "0".repeat(64) },
    ] },
  });
  assert.equal(tamperedHash.status, 400, "tampered legal document hash must be rejected before submission");
  assert.equal((await tamperedHash.json()).error, "LEGAL_DOCUMENT_HASH_MISMATCH");
  const incomplete = await callWorker("/v1/tools/submit_identity_documents", {
    token: userA.token, body: { org_id: organizationId, documents: [{ document_code: "TEST_REGISTRATION_CERT", ...registrationFile }] },
  });
  assert.equal(incomplete.status, 400, "incomplete legal document bundle must be rejected");
  assert.equal((await incomplete.json()).error, "REQUIRED_DOCUMENTS_INCOMPLETE");

  const permitPdf = new Uint8Array(Buffer.from("%PDF-1.4\nLOCAL FIXTURE permit\n%%EOF"));
  const permitFile = await uploadLegalFile(userA.token, organizationId, "factory-permit.pdf", permitPdf);
  const submittedLegal = await callWorker("/v1/tools/submit_identity_documents", {
    token: userA.token, body: { org_id: organizationId, documents: [
      { document_code: "TEST_REGISTRATION_CERT", ...registrationFile },
      { document_code: "TEST_FACTORY_PERMIT", ...permitFile, expiry_date: "2030-12-31" },
    ] },
  });
  assert.equal(submittedLegal.status, 200, `complete legal documents rejected: ${JSON.stringify(await submittedLegal.clone().json())}`);
  const legalDocumentIds = (await submittedLegal.json()).data.document_ids;
  assert.equal(legalDocumentIds.length, 2);
  const earlyVerify = await request("/rest/v1/rpc/verify_business", {
    method: "POST", admin: true, schema: "system", body: { p_org_id: organizationId },
  });
  assert.equal(earlyVerify.response.status, 400, "business cannot activate before document review");
  for (const legalDocumentId of legalDocumentIds) {
    const reviewed = await request("/rest/v1/rpc/review_legal_document", {
      method: "POST", admin: true, schema: "system",
      body: { p_document_id: legalDocumentId, p_decision: "VERIFIED", p_note: "LOCAL_TEST_ONLY" },
    });
    assert.equal(reviewed.response.status, 200, `local reviewer step failed: ${reviewed.response.status}`);
  }
  const expiredFixture = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "-c",
    `update public.org_legal_documents set expiry_date=current_date-1 where organization_id='${organizationId}' and document_code='TEST_FACTORY_PERMIT';`],
  { encoding: "utf8", env: psqlEnv });
  assert.equal(expiredFixture.status, 0, `could not create expiry test fixture: ${expiredFixture.stderr}`);
  const expiredVerify = await request("/rest/v1/rpc/verify_business", {
    method: "POST", admin: true, schema: "system", body: { p_org_id: organizationId },
  });
  assert.equal(expiredVerify.response.status, 400, "expired legal docs must block activation");
  const restoreExpiry = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "-c",
    `update public.org_legal_documents set expiry_date='2030-12-31' where organization_id='${organizationId}' and document_code='TEST_FACTORY_PERMIT';`],
  { encoding: "utf8", env: psqlEnv });
  assert.equal(restoreExpiry.status, 0, `could not restore expiry fixture: ${restoreExpiry.stderr}`);
  const verified = await request("/rest/v1/rpc/verify_business", {
    method: "POST", admin: true, schema: "system", body: { p_org_id: organizationId },
  });
  assert.equal(verified.response.status, 200, `verified legal docs should activate fixture org: ${verified.response.status}`);

  const allowedPolicy = await callWorker("/v1/tools/check_product_listing", {
    token: userA.token, body: { org_id: organizationId, title: "อิฐทดสอบ", category_code: "local_test_building" },
  });
  assert.equal(allowedPolicy.status, 200);
  assert.equal((await allowedPolicy.json()).data.allowed, true);
  const prohibitedPolicy = await callWorker("/v1/tools/check_product_listing", {
    token: userA.token, body: { org_id: organizationId, title: "sample banned-demo-item", category_code: "local_test_building" },
  });
  assert.equal(prohibitedPolicy.status, 200);
  const prohibitedPolicyResult = await prohibitedPolicy.json();
  assert.equal(prohibitedPolicyResult.data.allowed, false);
  assert.equal(prohibitedPolicyResult.data.reason, "PROHIBITED_GOODS_MATCH");
  const licensedPolicy = await callWorker("/v1/tools/check_product_listing", {
    token: userA.token, body: { org_id: organizationId, title: "เครื่องจักรโรงงาน", category_code: "local_test_factory" },
  });
  assert.equal((await licensedPolicy.json()).data.allowed, true, "verified factory permit should satisfy the fixture category rule");
  const legalRowsForOtherOrg = await request(`/rest/v1/org_legal_documents?organization_id=eq.${organizationId}&select=legal_document_id`, { token: userB.token });
  assert.equal(legalRowsForOtherOrg.response.status, 200);
  assert.equal(legalRowsForOtherOrg.payload.length, 0, "RLS must hide another organization's legal-document records");

  secondCompanyId = runSqlQuery(`with c as (
      insert into public.companies(name,type,status,updated_at,is_individual,organization_id)
      values ('Local Secondary Company','SUPPLIER','ACTIVE',now(),false,'${organizationId}'::uuid) returning id
    ), bp as (
      insert into public.business_profiles(company_name,verified_status,company_id,entity_type,operation_type,legal_status)
      select 'Local Secondary Profile',true,id,'INDIVIDUAL','SERVICE_PROVIDER','ACTIVE' from c returning id,company_id
    ), loc as (
      insert into public.business_locations(organization_id,company_id,label,latitude,longitude,location_geog,is_primary)
      select '${organizationId}'::uuid,company_id,'Local secondary location',13.75,100.50,
        public.st_setsrid(public.st_makepoint(100.50,13.75),4326)::public.geography,true from bp
      returning company_id
    ) select company_id from bp;`);
  assert.match(secondCompanyId, /^[0-9a-f-]{36}$/i, "fixture must create a second company in the same organization");
  const resolved = await request("/rest/v1/rpc/resolve_authorized_company", {
    method: "POST", token: userA.token, body: { p_organization_id: organizationId, p_company_id: companyId, p_minimum_role: "admin" },
  });
  assert.equal(resolved.response.status, 200, `authorized company resolver failed: ${JSON.stringify(resolved.payload)}`);
  assert.equal(resolved.payload[0].company_id, companyId);
  assert.ok(resolved.payload[0].business_profile_id);
  const legacyLegalAmbiguous = await request("/rest/v1/rpc/register_business_identity", {
    method: "POST", token: userA.token, body: { p_org_id: organizationId, p_entity_type: "JURISTIC",
      p_operation_type: "MANUFACTURER", p_registration_no: "LOCAL-AMBIGUOUS", p_tax_id: "0000000000001", p_registered_capital: null },
  });
  assert.equal(legacyLegalAmbiguous.response.status, 400);
  assert.match(JSON.stringify(legacyLegalAmbiguous.payload), /IDENTITY_COMPANY_SELECTION_REQUIRED/);

  const platformConnected = await callWorker("/v1/secure/platform/connect", {
    token: userA.token, body: { org_id: organizationId, platform_code: "local_test_platform", credentials: { api_key: "never-store-platform-secret" } },
  });
  assert.equal(platformConnected.status, 200, `platform connection failed: ${JSON.stringify(await platformConnected.clone().json())}`);
  const platformRow = (await request("/rest/v1/org_platform_connections?select=credentials_ciphertext", { admin: true })).payload;
  assert.equal(platformRow.length, 1);
  assert.ok(!platformRow[0].credentials_ciphertext.includes("never-store-platform-secret"));

  const connected = await callWorker("/v1/secure/erp/connect", {
    token: userA.token,
    body: { org_id: organizationId, provider: "custom", credentials: { api_token: "never-store-this-plaintext" } },
  });
  assert.equal(connected.status, 200, `ERP connect failed: ${JSON.stringify(await connected.clone().json())}`);
  const connection = (await connected.json()).data;
  const integrationId = connection.integration_id;
  const ingestToken = connection.ingest_token;
  assert.ok(ingestToken && ingestToken.length >= 40);
  const connectTool = await callWorker("/v1/tools/connect_erp", {
    token: userA.token, body: { org_id: organizationId, provider: "custom" },
  });
  assert.equal(connectTool.status, 200);
  assert.equal((await connectTool.json()).data.status, "credentials_required");
  const storedIntegration = await request(`/rest/v1/org_integrations?integration_id=eq.${integrationId}&select=credentials_ciphertext,ingest_token_sha256`, { admin: true });
  assert.equal(storedIntegration.response.status, 200);
  assert.equal(storedIntegration.payload.length, 1);
  assert.ok(!storedIntegration.payload[0].credentials_ciphertext.includes("never-store-this-plaintext"));

  const legacyErpAmbiguous = await request("/rest/v1/rpc/sync_erp_snapshot", {
    method: "POST", token: userA.token, schema: "system", body: { p_integration_id: integrationId,
      p_ingest_token: null, p_listings: [{ sku: "LEGACY-AMBIGUOUS", name: "must not be written", specs: {},
        price: 1, stock: 1, unit: "ชิ้น", category_code: "local_test_building" }] },
  });
  assert.equal(legacyErpAmbiguous.response.status, 400);
  assert.match(JSON.stringify(legacyErpAmbiguous.payload), /ERP_COMPANY_SELECTION_REQUIRED/);

  const badErpToken = await callWorker(`/v1/integrations/${integrationId}/sync`, {
    headers: { "x-erp-ingest-token": `${ingestToken}wrong` },
    body: { company_id: companyId, listings: [{ sku: "BRICK-001", name: "ไม่ควรบันทึก", specs: {}, price: 2.5, stock: 10, unit: "ชิ้น", category_code: "local_test_building" }] },
  });
  assert.equal(badErpToken.status, 403, "bad integration token must be rejected");

  const missingErpCompany = await callWorker(`/v1/integrations/${integrationId}/sync`, {
    headers: { "x-erp-ingest-token": ingestToken },
    body: { listings: [{ sku: "MISSING-COMPANY", name: "must not be written", specs: {}, price: 1, stock: 1, unit: "ชิ้น", category_code: "local_test_building" }] },
  });
  assert.equal(missingErpCompany.status, 400, "adapter request must explicitly select a company");

  const blockedSync = await callWorker(`/v1/integrations/${integrationId}/sync`, {
    headers: { "x-erp-ingest-token": ingestToken },
    body: { company_id: companyId, listings: [{ sku: "BLOCKED-ITEM", name: "banned-demo-item sample", specs: {}, price: 1, stock: 1, unit: "ชิ้น", category_code: "local_test_building" }] },
  });
  assert.equal(blockedSync.status, 400, "database listing gate must reject prohibited goods during ERP sync");
  assert.equal((await blockedSync.json()).error, "PROHIBITED_GOODS_MATCH");

  const sync = await callWorker(`/v1/integrations/${integrationId}/sync`, {
    headers: { "x-erp-ingest-token": ingestToken },
    body: { company_id: companyId, listings: [{ sku: "BRICK-001", name: "อิฐทดสอบ", specs: { type: "clay" }, price: 2.5, status: "AVAILABLE", stock: 10, unit: "ชิ้น", category_code: "local_test_building" }] },
  });
  assert.equal(sync.status, 200, `ERP sync failed: ${JSON.stringify(await sync.clone().json())}`);
  const syncData = (await sync.json()).data;
  assert.equal(syncData.listings_synced, 1);
  assert.equal(syncData.company_id, companyId, "service_role adapter path must bind the requested owner company");
  assert.ok(syncData.business_profile_id, "ERP result must identify its resolved business profile");

  const secondCompanySync = await callWorker(`/v1/integrations/${integrationId}/sync`, {
    headers: { "x-erp-ingest-token": ingestToken },
    body: { company_id: secondCompanyId, listings: [{ sku: "SECOND-COMPANY-001", name: "รายการบริษัทที่สอง", specs: {},
      price: 1, status: "AVAILABLE", stock: 3, unit: "ชิ้น", category_code: "local_test_building" }] },
  });
  assert.equal(secondCompanySync.status, 200, `second-company ERP sync failed: ${JSON.stringify(await secondCompanySync.clone().json())}`);
  assert.equal((await secondCompanySync.json()).data.company_id, secondCompanyId);
  const aiSync = await callWorker("/v1/tools/sync_erp_snapshot", {
    token: userA.token,
    body: { integration_id: integrationId, company_id: companyId,
      listings: [{ sku: "BRICK-001", name: "อิฐทดสอบ", specs: { type: "clay" }, price: 2.5, status: "AVAILABLE", stock: 10, unit: "ชิ้น", category_code: "local_test_building" }] },
  });
  assert.equal(aiSync.status, 200, `authorized AI sync tool failed: ${JSON.stringify(await aiSync.clone().json())}`);
  assert.equal((await aiSync.json()).data.listings_synced, 1);
  const listingRows = await request("/rest/v1/listing_catalog?select=listing_id,organization_id,company_id,name,location_latitude,location_longitude", { token: userA.token });
  assert.equal(listingRows.response.status, 200);
  const listing = listingRows.payload.find(row => row.name === "อิฐทดสอบ");
  assert.ok(listing, "ERP listing should be visible to its seller org");
  assert.equal(listing.organization_id, organizationId);
  assert.equal(listing.company_id, companyId);
  const secondListing = listingRows.payload.find(row => row.name === "รายการบริษัทที่สอง");
  assert.ok(secondListing, "second company's ERP listing should be present");
  assert.equal(secondListing.company_id, secondCompanyId, "listing ownership must not cross companies");
  assert.ok(Math.abs(listing.location_latitude - 13.7563) < 1e-8);
  assert.ok(Math.abs(listing.location_longitude - 100.5018) < 1e-8);

  const buyer = await callWorker("/v1/tools/onboard_business", {
    token: userB.token, body: { shop_name: "ผู้ซื้อทดสอบ", lat: 13.75, lng: 100.5 },
  });
  assert.equal(buyer.status, 200);
  const buyerData = (await buyer.json()).data;
  buyerOrganizationId = buyerData.organization_id;
  const buyerCompanyId = buyerData.company_id;
  const crossCompanyIdentity = await callWorker("/v1/secure/business/identity", {
    token: userA.token, body: { org_id: organizationId, company_id: buyerCompanyId,
      entity_type: "JURISTIC", operation_type: "MANUFACTURER", registration_no: "CROSS-ORG",
      tax_id: "0000000000002", registered_capital: null },
  });
  assert.equal(crossCompanyIdentity.status, 403, "legal RPC must reject a company owned by another organization");
  const crossCompanyResolve = await request("/rest/v1/rpc/resolve_authorized_company", {
    method: "POST", token: userA.token, body: { p_organization_id: organizationId, p_company_id: buyerCompanyId, p_minimum_role: "member" },
  });
  assert.equal(crossCompanyResolve.response.status, 403, "resolver must fail closed across organizations");
  const otherUserResolve = await request("/rest/v1/rpc/resolve_authorized_company", {
    method: "POST", token: userB.token, body: { p_organization_id: organizationId, p_company_id: companyId, p_minimum_role: "member" },
  });
  assert.equal(otherUserResolve.response.status, 403, "non-member must not resolve another organization's company");
  const unauthorizedUserErp = await callWorker("/v1/tools/sync_erp_snapshot", {
    token: userB.token, body: { integration_id: integrationId, company_id: companyId,
      listings: [{ sku: "UNAUTHORIZED-SYNC", name: "must not be written", specs: {}, price: 1,
        stock: 1, unit: "ชิ้น", category_code: "local_test_building" }] },
  });
  assert.equal(unauthorizedUserErp.status, 403, "authenticated non-member must not sync another organization's ERP");
  const crossOrgErp = await callWorker(`/v1/integrations/${integrationId}/sync`, {
    headers: { "x-erp-ingest-token": ingestToken },
    body: { company_id: buyerCompanyId, listings: [{ sku: "CROSS-ORG", name: "must not be written", specs: {}, price: 1, stock: 1, unit: "ชิ้น", category_code: "local_test_building" }] },
  });
  assert.equal(crossOrgErp.status, 403, "service_role adapter path must reject company outside integration organization");
  const createOrder = await callWorker("/v1/tools/create_order", {
    token: userB.token,
    body: { seller_org_id: organizationId, buyer_org_id: buyerOrganizationId,
      items: [{ listing_id: listing.listing_id, quantity: 6 }] },
  });
  assert.equal(createOrder.status, 200, `order failed: ${JSON.stringify(await createOrder.clone().json())}`);
  const orderData = (await createOrder.json()).data;
  const stock = await request(`/rest/v1/inventory_stocks?listing_id=eq.${listing.listing_id}&select=on_hand_quantity,reserved_quantity,available_quantity`, { token: userA.token });
  assert.equal(stock.response.status, 200);
  assert.equal(stock.payload[0].on_hand_quantity, 10);
  assert.equal(stock.payload[0].reserved_quantity, 6);
  assert.equal(stock.payload[0].available_quantity, 4);
  const undercutReservation = await callWorker(`/v1/integrations/${integrationId}/sync`, {
    headers: { "x-erp-ingest-token": ingestToken },
    body: { company_id: companyId, listings: [{ sku: "BRICK-001", name: "อิฐทดสอบ", specs: { type: "clay" }, price: 2.5, status: "AVAILABLE", stock: 5, unit: "ชิ้น", category_code: "local_test_building" }] },
  });
  assert.equal(undercutReservation.status, 400, "ERP cannot reduce on-hand below active reservations");
  const queues = await request(`/rest/v1/order_queues?order_id=eq.${orderData.order_id}&select=queue_stage,status`, { token: userB.token });
  assert.equal(queues.response.status, 200);
  assert.deepEqual(new Set(queues.payload.map(row => row.queue_stage)), new Set(["PACK", "DISPATCH"]));
  const reservations = await request(`/rest/v1/stock_reservations?select=quantity,status&order_item_id=not.is.null`, { token: userA.token });
  assert.equal(reservations.response.status, 200);
  assert.ok(reservations.payload.some(row => row.quantity === 6 && row.status === "RESERVED"));

  const location = await request(`/rest/v1/business_locations?company_id=eq.${companyId}&select=latitude,longitude`, { token: userA.token });
  assert.equal(location.response.status, 200);
  assert.equal(location.payload.length, 1);
  assert.ok(Math.abs(location.payload[0].latitude - 13.7563) < 1e-8);
  assert.ok(Math.abs(location.payload[0].longitude - 100.5018) < 1e-8);

  const requested = await callWorker("/v1/tools/request_business_document", {
    token: userA.token, body: { company_id: companyId, document_type: "business_license" },
  });
  assert.equal(requested.status, 200);
  const documentId = (await requested.json()).data.document_id;
  const submitted = await callWorker("/v1/tools/submit_business_document", {
    token: userA.token, body: { document_id: documentId, document_url: "https://example.test/license.pdf" },
  });
  assert.equal(submitted.status, 200);
  const turn = await callWorker("/v1/tools/consume_ai_interview_turn", {
    token: userA.token, body: { company_id: companyId },
  });
  assert.equal(turn.status, 200);
  assert.equal((await turn.json()).data.remaining, 19);
  const quotas = await callWorker("/v1/tools/report_business_quotas", { token: userA.token, body: { company_id: companyId } });
  assert.equal(quotas.status, 200);
  const quotaRows = await quotas.json();
  assert.equal(quotaRows.data.find(row => row.quota_code === "BUSINESS_DOCUMENTS").used, 1);
  assert.equal(quotaRows.data.find(row => row.quota_code === "AI_INTERVIEW_TURNS").remaining, 19);

  const crossTenant = await callWorker("/v1/tools/report_business_quotas", { token: userB.token, body: { company_id: companyId } });
  assert.equal(crossTenant.status, 403, `cross tenant read should be denied: ${crossTenant.status}`);
  const directCrossTenant = await request(`/rest/v1/business_locations?company_id=eq.${companyId}&select=id`, { token: userB.token });
  assert.equal(directCrossTenant.response.status, 200);
  assert.equal(directCrossTenant.payload.length, 0, "RLS should hide another user's location");

  console.log(JSON.stringify({
    result: "PASS",
    checks: ["local health", "unauthenticated rejected", "caller identity spoof rejected", "onboarding RPC",
      "juristic manufacturer identity", "explicit company identity binding", "multi-company legacy legal call fails closed", "cross-org legal binding denied", "tampered legal document hash rejected", "incomplete legal documents rejected", "private legal file upload", "cross-org legal file access denied",
      "service reviewer required before activation", "expired legal documents block activation", "verified docs activate business",
      "prohibited category tool blocks item", "database gate blocks prohibited ERP listing", "platform credentials encrypted",
      "PostGIS coordinates", "document request/submission", "AI quota usage", "quota report", "encrypted ERP connection",
      "AI ERP connect tool routes credentials securely", "bad ERP token rejected", "ERP snapshot sync",
      "authorized AI ERP snapshot tool with explicit company", "authenticated non-member ERP denied", "cross-org service-role ERP company binding denied", "listing organization/location join", "cross-organization order", "stock reserved atomically",
      "ERP cannot undercut active reservations", "missing company selection rejected", "multi-company ERP sync binds each requested owner",
      "PACK/DISPATCH queues created", "cross-tenant denied", "RLS hides location"],
    quota_defaults: { documents: 10, ai_interview_turns_monthly: 20, business_locations: 1 },
  }, null, 2));
} finally {
  // Remove only this test's own records from the local database, in dependency order.
  if (organizationId && companyId) {
    const orgIds = [organizationId, buyerOrganizationId].filter(Boolean).map(id => `'${id.replace(/[^0-9a-f-]/gi, "")}'`).join(",");
    const userList = createdUsers.map(id => `'${id.replace(/[^0-9a-f-]/gi, "")}'`).join(",");
    const cleanupSql = `begin;
      delete from public.stock_reservations where order_item_id in (select oi.order_item_id from public.order_items oi join public.orders o using(order_id) where o.seller_org_id in (${orgIds}) or o.buyer_org_id in (${orgIds}));
      delete from public.orders where seller_org_id in (${orgIds}) or buyer_org_id in (${orgIds});
      delete from public.products where business_id in (select id from public.business_profiles where company_id in (select id from public.companies where organization_id in (${orgIds})));
      delete from public.org_integrations where organization_id in (${orgIds});
      delete from public.business_profiles where company_id in (select id from public.companies where organization_id in (${orgIds}));
      delete from public.companies where organization_id in (${orgIds});
      delete from public.organizations where id in (${orgIds});
      delete from public.required_documents_master where policy_version='LOCAL_E2E_TEST_V1';
      delete from public.prohibited_goods where policy_reference='TEST_FIXTURE' and reason_code='LOCAL_TEST_BLOCK';
      delete from public.product_categories where category_code in ('local_test_building','local_test_factory');
      delete from public.supported_platforms where platform_code='local_test_platform';
      delete from auth.users where id in (${userList || "null"}); commit;`;
    const cleanup = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", "-c", cleanupSql], {
      encoding: "utf8", env: psqlEnv,
    });
    if (cleanup.status !== 0) console.error("Local fixture cleanup failed; check only the disposable local database.");
  } else if (createdUsers.length) {
    for (const id of createdUsers) await request(`/auth/v1/admin/users/${id}`, { method: "DELETE", admin: true });
  }
  if (uploadedLegalPaths.length) {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/org-legal-documents`, {
      method: "DELETE", headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: uploadedLegalPaths }),
    });
    if (!response.ok) console.error("Local legal file cleanup failed; remove only the listed Local test paths.");
  }
}
