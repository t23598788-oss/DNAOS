/** พิสูจน์ว่า guard ปฏิเสธจริง ไม่ใช่แค่เขียนคอมเมนต์ไว้ */
import { TEST_FIXTURE_TYPE, TEST_FIXTURE_ROOT } from "../../software/capability-registrar/write-ownership-index";
console.log("TEST_FIXTURE_TYPE =", TEST_FIXTURE_TYPE, "| ROOT =", TEST_FIXTURE_ROOT);
const norm = (p: string) => (p.endsWith("/") ? p : `${p}/`);
for (const p of ["tests/__sandbox__/true-test-a/", "control/agent-gateway/", "software/", "tests/", "/"]) {
  const allowed = norm(p).startsWith(TEST_FIXTURE_ROOT);
  console.log(`  ${p.padEnd(34)} -> ${allowed ? "ALLOWED_FOR_FIXTURE" : "REFUSED"}`);
}
