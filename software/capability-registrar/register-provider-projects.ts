/**
 * หน้าที่: ลงทะเบียน **ตัวตน** ของ provider project ที่มีหลักฐานจริง ผ่าน
 * `software/provider-project-registry/` — ไม่เขียนไฟล์เอง ไม่มี stage ของตัวเอง
 *
 * DigitalOcean ตั้งใจให้ตกที่ UNRESOLVED เพราะยังไม่มีตัวระบุที่ผู้ให้บริการ
 * ออกให้ในหลักฐานที่มี — ไม่ใช่ข้อผิดพลาดของสคริปต์
 *
 * Usage: npx tsx software/capability-registrar/register-provider-projects.ts
 */
import { registerProviderProject, getProviderProject, buildProviderProjectId, listProviderProjects }
  from "../provider-project-registry/contract";
import type { RegisterProviderProjectInput } from "../provider-project-registry/contract";

const CANDIDATES: readonly (readonly [string, RegisterProviderProjectInput])[] = [
  ["Railway", {
    provider_id: "railway",
    identifiers: { project: "dna-os-infrastructure", environment_id: "4d28eafa-9735-4405-a585-55ea354bafab" },
    verified_by: [
      "connections/railway/router-invoker.ts (ENVIRONMENT_ID constant)",
      "credentials/registry — credential://railway/dna-os-infrastructure/production/project-token (ACTIVE)",
    ],
  }],
  ["Supabase", {
    provider_id: "supabase",
    identifiers: { project_ref: "xeytcavxejhyzxwevgto" },
    verified_by: [
      "execution/run/process-registry.ts:123 (SUPABASE_PRODUCTION_PROJECT_REF)",
      "credentials/registry — credential://supabase/xeytcavxejhyzxwevgto/PROVIDER_ALERT_EMAIL_READ_SECRET (ACTIVE)",
    ],
  }],
  ["DigitalOcean", {
    provider_id: "digitalocean",
    identifiers: {},
    verified_by: ["connections/digitalocean/digitalocean-read-api.ts (CORE_V2_BASE_URL — เป็น API host ไม่ใช่ตัวตนของ project)"],
  }],
];

function main(): number {
  for (const [label, input] of CANDIDATES) {
    const r = registerProviderProject(input);
    console.log(`\n■ ${label}`);
    console.log(`   status   : ${r.status}${r.reason ? "  (" + r.reason + ")" : ""}`);
    if (!r.registration) continue;
    console.log(`   id       : ${r.registration.provider_project_id}`);
    const back = getProviderProject(buildProviderProjectId(input.provider_id, input.identifiers));
    console.log(`   read back: ${back ? "OK identifiers=" + JSON.stringify(back.identifiers) : "NOT FOUND"}`);
  }
  console.log(`\nรวมในทะเบียน: ${listProviderProjects().length} แถว`);
  return 0;
}

process.exit(main());
