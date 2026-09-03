/**
 * หน้าที่: พิสูจน์ว่า production census นับ credential ได้ถูก โดยไม่ลบ fixture
 * และไม่เปิดเผย secret
 *
 * ทะเบียนเป็น append-only และไฟล์เทสต์เขียนลงไฟล์เดียวกับ production
 * การนับตรง ๆ จึงได้ 134 ทั้งที่ของจริงมี 4
 */
import { listApiCredentials, classifyApiCredential, countApiCredentialsByClassification,
  listProductionApiCredentials, TEST_FIXTURE_ACCOUNT } from "../api-credential-registry";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (d ? "  -> " + d : "")); }
};

const counts = countApiCredentialsByClassification();
console.log(`\nนับได้: PRODUCTION=${counts.PRODUCTION} TEST_FIXTURE=${counts.TEST_FIXTURE} UNCLASSIFIED=${counts.UNCLASSIFIED} total=${counts.total}\n`);

// 2026-09-02: +1 เมื่อเจ้าของเปิดช่องตั้งค่า Anthropic API Key ใน Owner Settings
// (credential://anthropic/owner/agent-runtime) — เทสต์นี้เป็นบัญชีของจริง
// ตัวเลขจึงต้องขยับตามเมื่อมีของจริงเพิ่ม ไม่ใช่ตรึงไว้ให้ผ่าน
ok("PRODUCTION_CREDENTIAL_COUNT = 5", counts.PRODUCTION === 5, String(counts.PRODUCTION));
ok("TEST_FIXTURE_COUNT = 130", counts.TEST_FIXTURE === 130, String(counts.TEST_FIXTURE));
ok("ไม่มีแถวที่จำแนกไม่ได้ (marker ทั้งสามตรงกันทุกแถว)", counts.UNCLASSIFIED === 0, String(counts.UNCLASSIFIED));
ok("สามกลุ่มรวมกันเท่าจำนวนแถวทั้งหมด", counts.PRODUCTION + counts.TEST_FIXTURE + counts.UNCLASSIFIED === counts.total);

// fixture ต้องยังอยู่ครบ — รอบนี้ห้ามลบ
ok("fixture ไม่ถูกลบ ยังอยู่ในทะเบียนครบ", listApiCredentials().length === counts.total, String(listApiCredentials().length));

const prod = listProductionApiCredentials();
ok("listProductionApiCredentials คืน 5 แถว", prod.length === 5, String(prod.length));
ok("ไม่มี fixture หลุดเข้ามาใน production", prod.every((e) => e.account !== TEST_FIXTURE_ACCOUNT));

const providers = [...new Set(prod.map((e) => e.provider))].sort();
ok("provider ของจริงคือ anthropic/github/n8n/railway/supabase",
  JSON.stringify(providers) === JSON.stringify(["anthropic", "github", "n8n", "railway", "supabase"]), JSON.stringify(providers));

// SECRET POLICY — ทะเบียนต้องไม่มีค่า secret จริงเลย
const SECRET_FIELDS = ["secret", "token", "password", "api_key", "value", "private_key"];
ok("ไม่มีฟิลด์ที่เก็บ secret ในทุกแถว",
  listApiCredentials().every((e) => SECRET_FIELDS.every((f) => !(f in (e as unknown as Record<string, unknown>)))));
ok("credential_ref เป็น pointer เสมอ (ขึ้นต้น credential://)",
  prod.every((e) => e.credential_ref.startsWith("credential://")));
ok("resolver ทุกตัวเป็น macos_keychain (secret อยู่นอกทะเบียน)",
  prod.every((e) => e.resolver_kind === "macos_keychain"), JSON.stringify(prod.map((e) => e.resolver_kind)));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
