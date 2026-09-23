/**
 * Regression test for SLICE-2 — the JOB path into the NEW Business Workspace.
 *
 * Proves the job tool is wired through the CENTRAL authority to the EXISTING
 * canonical path, and that nothing parallel or fabricated was introduced:
 *   1. authority: "jobs" granted to the admin tier, denied for partner/customer
 *   2. an undeclared capability is denied even for super_admin (default deny)
 *   3. registry keys == UI tool keys (no drift) and "jobs" is among them
 *   4. the job builder imports the EXISTING canonical sources only
 *      (services/supabase/queries + services/canonical/transaction-list), never
 *      the broken getJobs()/transport_jobs path
 *   5. the builder renders ONLY from its inputs — empty input yields an empty
 *      model (no embedded/mock business rows)
 *   6. resource relations presented are the ones the existing FK join really
 *      carries (company/person); no invented material/vehicle/equipment field
 *   7. exactly ONE module reads registry/permissions.json#capability_access
 *      (no second permission resolver)
 *   8. the job read in app/workspace/page.tsx is gated on the authority result
 *   9. renderer = the canonical BusinessDisplayRenderer, no new renderer file
 * No network, no Supabase session, no credentials.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import permissions from "@/registry/permissions.json";
import { isCapabilityAllowed, resolveAllowedCapabilities } from "@/core/navigation/resolveCapabilityAccess";
import { TOOLS } from "@/app/workspace/_lib/businessTools";
import { getTransactions } from "@/services/supabase/queries";
import { type TransactionMoneySummary } from "@/services/canonical/transaction-list";
import { buildJobListModel, buildJobTargets, JOB_TABLE_TARGET_ID } from "@/app/workspace/_lib/jobDisplayModel";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

type Row = Awaited<ReturnType<typeof getTransactions>>[number];

const FIXTURE_ROW = {
  id: "job-a",
  title: "SO-TEST-0001",
  state: "CONFIRMED",
  created_at: "2026-09-01T00:00:00.000Z",
  partners: { id: "company-a", name: "บริษัท ทดสอบ จำกัด", phone: "0800000000" },
} as unknown as Row;

const FIXTURE_MONEY = new Map<string, TransactionMoneySummary>([
  [
    "job-a",
    {
      order_id: "job-a",
      document_count: 2,
      subtotal: 1000,
      vat_amount: 70,
      gross_amount: 1070,
      paid_amount: 500,
      outstanding: 570,
      data_completeness: "FULL",
    },
  ],
]);

function main() {
  // 1 + 2 · authority
  for (const role of ["super_admin", "admin", "employee"] as const) {
    assert.ok(isCapabilityAllowed("jobs", role), `${role} must be granted the jobs tool`);
  }
  for (const role of ["partner", "customer"] as const) {
    assert.equal(isCapabilityAllowed("jobs", role), false, `${role} must not be granted the jobs tool`);
    assert.equal(resolveAllowedCapabilities(role).includes("jobs"), false, `${role} must not resolve jobs`);
  }
  assert.equal(isCapabilityAllowed("__not_declared__", "super_admin"), false, "undeclared keys must stay denied");

  // 3 · registry vs UI keys
  const registryKeys = Object.keys(permissions.capability_access).sort();
  const uiKeys = TOOLS.map((t) => t.key).sort();
  assert.deepEqual(registryKeys, uiKeys, "capability_access keys must equal the UI tool keys");
  assert.ok(uiKeys.includes("jobs"), "the UI must declare a jobs business tool");

  // 4 + 6 · the builder uses the existing canonical sources and invents no relation source
  //    (checked against real CODE — the module's own doc comment is allowed to
  //     name the broken transport_jobs path it deliberately does not use)
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const builderCode = stripComments(read("app/workspace/_lib/jobDisplayModel.ts"));
  assert.ok(builderCode.includes("@/services/supabase/queries"), "job builder must use the existing query layer");
  assert.ok(builderCode.includes("@/services/canonical/transaction-list"), "job builder must use the canonical money summary");
  for (const forbidden of ["transport_jobs", "getJobs(", "customer_order_items", "job_vehicle_pricings", "equipment_assets", "driver_profiles"]) {
    assert.equal(builderCode.includes(forbidden), false, `job builder code must not reference ${forbidden}`);
  }

  // 5 · renders only from its inputs
  const model = JSON.stringify(buildJobListModel([FIXTURE_ROW], FIXTURE_MONEY));
  assert.ok(model.includes("SO-TEST-0001"), "list model must carry the input row's order number");
  assert.ok(model.includes("บริษัท ทดสอบ จำกัด"), "list model must carry the existing company relation");
  assert.ok(model.includes("570"), "list model must carry the canonical outstanding value");
  const emptyModel = JSON.stringify(buildJobListModel([], new Map()));
  assert.ok(emptyModel.includes("ยังไม่มีงานในระบบ"), "empty input must render an honest empty state");
  assert.equal(emptyModel.includes("SO-TEST-0001"), false, "an empty input must not leak any row");

  const targets = buildJobTargets([FIXTURE_ROW], FIXTURE_MONEY);
  assert.ok(targets[JOB_TABLE_TARGET_ID], "the canonical jobs table target must exist");
  const detail = JSON.stringify(targets["job:job-a"]);
  assert.ok(detail.includes("CONFIRMED"), "detail must show the real DB state");
  assert.ok(detail.includes("FULL"), "detail must show the canonical data_completeness basis");
  assert.equal(/วัสดุ|ยานพาหนะ|เครื่องจักร/.test(detail), false, "no material/vehicle/equipment relation may be invented");

  // 7 · one authority reader only
  const readers: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const p = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name) && stripComments(read(p)).includes("capability_access")) readers.push(p);
    }
  };
  for (const dir of ["core", "app", "engines", "services", "presentation"]) walk(dir);
  assert.deepEqual(
    readers,
    ["core/navigation/resolveCapabilityAccess.ts"],
    `capability_access must be read by exactly one module, got ${readers.join(", ")}`,
  );

  // 8 · the page gates the job read on the authority result
  assert.ok(
    read("app/workspace/page.tsx").includes('allowedTools.includes("jobs")'),
    "the job read must be gated on the authority result",
  );

  // 9 · canonical renderer only
  assert.ok(
    read("app/workspace/BusinessWorkspace.tsx").includes("BusinessDisplayRenderer"),
    "the workspace must render through BusinessDisplayRenderer",
  );
  const renderers = readdirSync(join(ROOT, "app/workspace"), { recursive: true, encoding: "utf-8" }).filter((f) =>
    /Renderer.*\.(tsx|ts)$/.test(f),
  );
  assert.deepEqual(renderers, [], `app/workspace must not add its own renderer, found ${renderers.join(", ")}`);

  console.log("workspace-job-path:test PASS");
  console.log(
    "checks: authority(jobs) admin-tier only · default deny · registry==UI keys · existing canonical sources only · input-driven model (no mock) · no invented resource relation · one authority reader · gated page read · canonical renderer only",
  );
}

main();
