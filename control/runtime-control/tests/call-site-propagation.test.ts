/**
 * CASE 19–24: ผู้เรียกจริงส่ง provenance มาถึงจริงหรือไม่
 *
 * เทสต์ก่อนหน้าพิสูจน์ว่า "ถ้าส่งมา จะถูกบันทึกถูกต้อง" ไฟล์นี้พิสูจน์อีกครึ่ง
 * ที่เหลือ: **ผู้เรียกจริงส่งมาแล้ว** — โดยอ่านซอร์สของจุดเรียกที่ระบุตัวได้แล้ว
 * ไม่ใช่การรัน runOperation จริง เพราะการรันมันคือการรีสตาร์ทบริการ production
 * เพื่อให้เทสต์เขียว ซึ่งไม่ใช่หลักฐาน
 *
 * ชนิดข้อมูลของสิ่งที่ส่งถูกพิสูจน์แยกโดย tsc (RuntimeOperationRequest)
 * ไฟล์นี้พิสูจน์เฉพาะว่า "ส่ง" กับ "ไม่แต่งตัวตนขึ้นมา"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown): void => {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); }
  else { fail += 1; console.log(`FAIL  ${name}`); if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`); }
};
const src = (p: string): string => readFileSync(join(process.cwd(), p), "utf-8");

const gateway = src("control/owner-backbone/gateway.ts");
check("CASE 19 สาย Owner ส่ง provenance เข้า runOperation และใช้ authority_context เดิม",
  /runOperation\(command\.target as ServiceId, action, runtimeRequest\)/.test(gateway)
  && /requested_by: command\.authority_context/.test(gateway));
check("CASE 20 สาย Owner ไม่ได้แกะตัวตนจากข้อความของคน",
  !/requested_action[^\n]*match|parse[^\n]*requested_action/.test(gateway));

const recovery = src("control/owner-backbone/autonomous-recovery.ts");
check("CASE 21 สายกู้คืนส่งตัวตนแบบ service ไม่ใช่ human และไม่ใช่ owner",
  /recoverRuntime\(serviceId, \{/.test(recovery)
  && /identity_id: "identity-recovery-supervisor", kind: "service"/.test(recovery)
  && !/identity_id: "owner"/.test(recovery));

const rehydrate = src("control/work-session-state/rehydrate.ts");
check("CASE 22 recoverRuntime ส่งต่อ request ลง runOperation ไม่ทิ้งกลางทาง",
  /recoverRuntime\(serviceId: string, request\?: RuntimeOperationRequest\)/.test(rehydrate)
  && /runOperation\(serviceId as never, "restart" as never, request\)/.test(rehydrate));

const reload = src("control/service-reload/resolver.ts");
check("CASE 23 service-reload ให้ตัวตนเฉพาะเส้นทาง AUTOMATIC เท่านั้น",
  /trigger === "AUTOMATIC"\n?\s*\?/.test(reload)
  && /identity_id: "identity-service-reload", kind: "service"/.test(reload)
  && /: undefined;/.test(reload));

const cli = src("control/runtime-control/cli.ts");
check("CASE 24 CLI ไม่ประกาศตัวเองเป็น Owner และไม่แต่งตัวตนใด ๆ",
  !/requested_by/.test(cli) && !/identity_id/.test(cli));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
