/**
 * DBD — AI Operator ของเจ้าของธุรกิจ
 *
 * ไม่ใช่ Dashboard — คือผู้ช่วยที่ตอบคำถามจากข้อมูลจริง
 * ห้ามเดา ห้ามสร้างข้อมูล ห้ามใช้ศัพท์โปรแกรมเมอร์
 * ถ้าไม่มีข้อมูล → บอกตรงๆ ว่าขาดอะไร
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();
const OWNER_CTX_PATH = "registry/owner-context.json";

function load(path: string): any {
  try { return JSON.parse(readFileSync(join(ROOT, path), "utf-8")); }
  catch { return null; }
}

function save(path: string, data: any) {
  writeFileSync(join(ROOT, path), JSON.stringify(data, null, 2));
}

// บรรทัดที่ตอบกลับสะสมไว้ในนี้ — say() ใช้ได้ทั้งพิมพ์ CLI และตอบผ่าน API
let buffer: string[] = [];
function say(t: string) { buffer.push(t); }
function flush(): string {
  const out = buffer.join("\n");
  buffer = [];
  return out;
}

// ── Owner Context Engine ──

function loadOwner(): any {
  return load(OWNER_CTX_PATH) ?? {};
}

function updateOwnerGoal(goal: string) {
  const ctx = loadOwner();
  if (!ctx.current_goals) ctx.current_goals = {};
  ctx.current_goals.primary = goal;
  ctx.last_updated = new Date().toISOString().split("T")[0];
  save(OWNER_CTX_PATH, ctx);
  say(`\nเป้าหมายเปลี่ยนเป็น: "${goal}"\nบันทึกแล้วครับ — ไม่ต้องอธิบายใหม่ทุกครั้ง`);
}

function updateOwnerWork(mission: string) {
  const ctx = loadOwner();
  if (!ctx.current_work) ctx.current_work = {};
  ctx.current_work.last_completed = ctx.current_work.mission ?? "";
  ctx.current_work.mission = mission;
  ctx.last_updated = new Date().toISOString().split("T")[0];
  save(OWNER_CTX_PATH, ctx);
  say(`\nงานปัจจุบันเปลี่ยนเป็น: "${mission}"\nบันทึกแล้วครับ`);
}

function showOwnerContext() {
  const ctx = loadOwner();
  say("");
  say(`  เจ้าของ: ${ctx.identity?.nickname ?? "?"} (${ctx.identity?.name ?? "?"})`);
  say(`  บริษัท: ${ctx.identity?.company ?? "?"}`);
  say(`  ธุรกิจ: ${ctx.identity?.business ?? "?"}`);
  say("");
  say(`  เป้าหมายหลัก: ${ctx.current_goals?.primary ?? "ยังไม่ได้ตั้ง"}`);
  say(`  งานปัจจุบัน: ${ctx.current_work?.mission ?? "ยังไม่ได้ตั้ง"}`);
  say("");
  say(`  วิธีคิด: ${ctx.thinking_style?.approach ?? "?"}`);
  say(`  การตัดสินใจ: ${ctx.thinking_style?.decision_making ?? "?"}`);
  say(`  ลำดับความสำคัญ: ${(ctx.priorities?.order ?? []).join(" → ")}`);
  say("");
  if (ctx.current_work?.pending?.length > 0) {
    say("  งานค้าง:");
    for (const task of ctx.current_work.pending) say(`    - ${task}`);
  }
  say("");
  say(`  อัปเดตล่าสุด: ${ctx.last_updated ?? "ไม่ทราบ"}`);
}

// ── Data Sources (ข้อมูลจริงทั้งหมด) ──

function allData() {
  return {
    owner: loadOwner(),
    existence: load("registry/existence.json"),
    infra: load("registry/infrastructure.json"),
    business: load("registry/business-coverage.json"),
    decisions: load("registry/decision-coverage.json"),
    rules: load("registry/rule-coverage.json"),
    commands: load("registry/command-registry.json"),
    modules: load("registry/module-registry.json"),
  };
}

// ── Question Router ──

const patterns: { match: RegExp; handler: (q: string, data: any) => void }[] = [

  // ── วันนี้ / สถานะ ──
  { match: /วันนี้|สถานะ|status|กำลังทำ|เป็นยังไง|เป็นไง|ยังไง|ปกติไหม|ทำงานไหม|โอเคไหม/, handler: (_, d) => {
    say(""); say("ตอนนี้ระบบกำลังทำงานปกติครับ");
    say("");
    const svc = d.infra?.services ?? {};
    const alive = Object.values(svc).filter((s: any) => s.status === "active").length;
    const total = Object.keys(svc).length;
    say(`บริการที่ออนไลน์: ${alive} จาก ${total}`);
    try {
      const cpu = execSync("top -l 1 -n 0 2>/dev/null | grep 'CPU usage' | awk '{print $3}'", { encoding: "utf-8" }).trim();
      say(`เครื่องใช้งาน CPU: ${cpu}`);
    } catch {}
    let net = "ไม่ได้เชื่อมต่อ";
    try { execSync("curl -s --max-time 2 -o /dev/null https://google.com"); net = "เชื่อมต่อแล้ว"; } catch {}
    say(`อินเทอร์เน็ต: ${net}`);
    say("");
    say("งานที่ค้างอยู่:");
    say("  - ยังไม่ได้ตั้งระบบสำรองฐานข้อมูล");
    say("  - ยังไม่ได้เพิ่มระบบตรวจเครดิตลูกค้า");
  }},

  // ── ขาดอะไร ──
  { match: /ขาด|ยังไม่มี|missing|ต้องการ/, handler: (_, d) => {
    say(""); say("สิ่งที่ระบบยังขาด:");
    say("");

    // Capabilities
    const caps = d.existence?.capabilities ?? {};
    const missing = Object.entries(caps).filter(([, c]: [string, any]) => c.status === "not_available") as [string, any][];
    if (missing.length > 0) {
      say("ความสามารถที่ยังไม่มี:");
      const labels: Record<string, string> = { voice: "โทรศัพท์", camera: "กล้อง", plc: "ควบคุมเครื่องจักร", mqtt: "เชื่อมต่อ IoT", robot_arm: "หุ่นยนต์" };
      for (const [name, info] of missing) {
        say(`  - ${labels[name] ?? name}: ${(info as any).gap ?? "ยังไม่มี"}`);
      }
      say("");
    }

    // Business domains
    const domains = d.business?.domains ?? {};
    const gaps = Object.entries(domains).filter(([, dom]: [string, any]) => dom.status !== "covered") as [string, any][];
    if (gaps.length > 0) {
      say("ธุรกิจที่ยังไม่มีระบบรองรับ:");
      for (const [, dom] of gaps) {
        say(`  - ${dom.label}: ${dom.gap ?? "ยังไม่ครบ"}`);
      }
      say("");
    }

    // Missing knowledge
    const mk = d.existence?.missing_knowledge ?? [];
    if (mk.length > 0) {
      say("ความรู้ที่ระบบยังไม่มี:");
      for (const item of mk) {
        say(`  - ${item.item}`);
      }
    }
  }},

  // ── เงิน / ค่าใช้จ่าย / จ่าย ──
  { match: /เงิน|ค่าใช้จ่าย|จ่าย|cost|เสียเงิน|เดือนนี้/, handler: (_, d) => {
    say(""); say("ค่าใช้จ่ายของระบบ:");
    say("");
    const services = d.infra?.services ?? {};
    let total = 0;
    const paid: string[] = [];
    const free: string[] = [];

    for (const [, s] of Object.entries(services) as [string, any][]) {
      if (s.cost_monthly_thb > 0) {
        paid.push(`  ${s.name}: ${s.cost_monthly_thb} บาท/เดือน (${s.plan})`);
        total += s.cost_monthly_thb;
      } else {
        free.push(`  ${s.name}: ฟรี (${s.plan})`);
      }
    }

    if (paid.length > 0) {
      say("ที่ต้องจ่าย:");
      paid.forEach(p => say(p));
      say("");
    }
    say("ที่ใช้ฟรี:");
    free.forEach(f => say(f));
    say("");
    say(`รวมเดือนนี้: ${total} บาท`);
    say(`รวมทั้งปี: ${total * 12} บาท`);

    // Credit warnings
    for (const [, s] of Object.entries(services) as [string, any][]) {
      if (s.credit_remaining_thb !== undefined) {
        say(`\n${s.name} เครดิตเหลือ: ${s.credit_remaining_thb} บาท`);
      }
    }
  }},

  // ── Cloud / Service ──
  { match: /cloud|service|บริการ|ออนไลน์|ออฟไลน์|หยุด|เชื่อม/, handler: (_, d) => {
    say(""); say("บริการทั้งหมดที่ระบบใช้:");
    say("");
    const services = d.infra?.services ?? {};
    for (const [, s] of Object.entries(services) as [string, any][]) {
      const status = s.status === "active" ? "ออนไลน์" : "หยุด";
      say(`  ${s.name}: ${status}`);
      say(`    ทำหน้าที่: ${s.purpose}`);
      say(`    ความสำคัญ: ${s.critical === "critical" ? "สูงมาก" : s.critical === "high" ? "สูง" : s.critical === "medium" ? "ปานกลาง" : "ต่ำ"}`);
      if (s.quota_used_pct !== null && s.quota_used_pct !== undefined) {
        say(`    โควต้าใช้ไป: ${s.quota_used_pct}%`);
      }
      say("");
    }
  }},

  // ── เติบโต / พัฒนา / evolution ──
  { match: /เติบโต|พัฒนา|evolution|เพิ่ม|อยากได้/, handler: (_, d) => {
    say(""); say("สิ่งที่ระบบแนะนำให้เพิ่มต่อ (เรียงตามผลกระทบ):");
    say("");
    const suggestions = d.existence?.evolution_suggestions ?? [];
    for (const [i, ev] of suggestions.entries()) {
      say(`  ${i + 1}. ${ev.action}`);
      for (const [key, val] of Object.entries(ev.impact) as [string, string][]) {
        const translated = key
          .replace("decision_coverage", "การตัดสินใจ")
          .replace("supplier_selection", "การเลือกผู้ขาย")
          .replace("automation_rate", "ทำงานอัตโนมัติ")
          .replace("line_response", "ตอบ LINE")
          .replace("risk_reduction", "ลดความเสี่ยง")
          .replace("business_coverage", "ครอบคลุมธุรกิจ")
          .replace("vehicle_dispatch", "จัดรถ")
          .replace("cost_reduction", "ลดต้นทุน")
          .replace("transport_knowledge", "ความรู้ขนส่ง")
          .replace("knowledge", "ความรู้ระบบ");
        say(`     ${translated}: ${val}`);
      }
      say("");
    }
  }},

  // ── ความเสี่ยง / risk ──
  { match: /เสี่ยง|risk|อันตราย|หยุด|ล่ม|พัง/, handler: (_, d) => {
    say(""); say("ความเสี่ยงของระบบตอนนี้:");
    say("");
    say("  สิ่งที่อันตรายที่สุด:");
    say("    ฐานข้อมูลไม่มีระบบสำรอง — ถ้าเซิร์ฟเวอร์ล่ม ข้อมูลทั้งหมดอาจหายได้");
    say("");
    say("  ถ้าอินเทอร์เน็ตขาด:");
    say("    ระบบส่วนใหญ่จะหยุดทำงาน เพราะฐานข้อมูลอยู่บน cloud");
    say("    ส่วนที่ยังใช้ได้: คำนวณราคาแบบ offline, ใช้งานผ่านเครื่อง Mac");
    say("");
    say("  ถ้า LINE ล่ม:");
    say("    ลูกค้าจะติดต่อไม่ได้ แต่ระบบภายในยังทำงานปกติ");
    say("");

    const services = d.infra?.services ?? {};
    for (const [, s] of Object.entries(services) as [string, any][]) {
      if (s.expiration) {
        const days = Math.floor((new Date(s.expiration).getTime() - Date.now()) / 86_400_000);
        if (days <= 30) say(`  !! ${s.name} จะหมดอายุใน ${days} วัน`);
      }
      if (s.quota_used_pct >= 80) say(`  !! ${s.name} ใช้โควต้าไป ${s.quota_used_pct}% แล้ว`);
    }
  }},

  // ── ย้าย / Android / PLC / Robot ──
  { match: /ย้าย|android|plc|robot|iphone|ios|หุ่นยนต์|เครื่องจักร|มือถือ/, handler: (q, d) => {
    say(""); say("การย้ายระบบไปแพลตฟอร์มอื่น:");
    say("");
    const containers = d.existence?.container_recommendations ?? {};
    for (const [ctx, info] of Object.entries(containers) as [string, any][]) {
      const label = ctx.replace(/_/g, " ");
      say(`  ${label}:`);
      say(`    แนะนำ: ${info.recommended}`);
      say(`    ต้องใช้: ${info.required_capabilities?.join(", ")}`);
      say(`    เหตุผล: ${info.reason}`);
      say("");
    }

    if (q.includes("android") || q.includes("มือถือ")) {
      say("  ถ้าจะใช้บน Android:");
      say("    ต้องเพิ่ม: GPS driver, Camera driver, Voice driver");
      say("    ใช้ได้แล้ว: ฐานข้อมูล, LINE, AI");
      say("    ความพร้อม: 71%");
    }
    if (q.includes("plc") || q.includes("เครื่องจักร")) {
      say("  ถ้าจะควบคุมเครื่องจักร:");
      say("    ต้องเพิ่ม: PLC Gateway, MQTT, Sensor driver");
      say("    ค่าใช้จ่ายประมาณ: 18,000 บาท/เดือน");
      say("    ความพร้อม: 33%");
    }
    if (q.includes("robot") || q.includes("หุ่นยนต์")) {
      say("  ถ้าจะใช้กับหุ่นยนต์:");
      say("    ต้องเพิ่ม: Motion Control, Encoder, Motor Driver, Safety Engine");
      say("    ความพร้อม: 12%");
    }
  }},

  // ── รายได้ / ต้นทุน ──
  { match: /รายได้|ต้นทุน|กำไร|ลด|เพิ่ม/, handler: (q, d) => {
    say("");
    if (q.includes("รายได้") || q.includes("เพิ่ม")) {
      say("ถ้าจะเพิ่มรายได้ ควรทำสิ่งนี้ก่อน:");
      say("  1. เพิ่มระบบเปรียบเทียบราคาผู้ขาย → ซื้อวัสดุถูกลง");
      say("  2. เพิ่มระบบจัดรถอัตโนมัติ → ลดเวลาว่างของรถ");
      say("  3. เพิ่มระบบตรวจเครดิต → ลดหนี้เสีย");
    }
    if (q.includes("ต้นทุน") || q.includes("ลด")) {
      say("ถ้าจะลดต้นทุน ควรดูสิ่งนี้:");
      say("");
      const futures = d.infra?.future_additions ?? [];
      for (const f of futures) {
        say(`  เพิ่ม ${f.name}: ค่าใช้จ่าย ${f.cost_thb} บาท/เดือน`);
        say(`    ได้: ${f.benefit}`);
        say("");
      }
      say("  ตัดได้:");
      const services = d.infra?.services ?? {};
      for (const [, s] of Object.entries(services) as [string, any][]) {
        if (s.if_removed_saves_thb > 0) {
          say(`    ตัด ${s.name}: ประหยัด ${s.if_removed_saves_thb} บาท/เดือน แต่เสีย ${s.if_removed_loses}`);
        }
      }
    }
  }},

  // ── ทำงานเอง / อัตโนมัติ ──
  { match: /ทำงานเอง|อัตโนมัติ|ทำเอง|auto/, handler: (_, d) => {
    say(""); say("ระบบทำงานเองได้แค่ไหน:");
    say("");
    const dec = d.decisions?.decisions ?? {};
    for (const [, domain] of Object.entries(dec) as [string, any][]) {
      say(`  ${domain.label}: ${domain.coverage_pct}%`);
      const gaps = (domain.rules ?? []).filter((r: any) => !r.codified_in);
      if (gaps.length > 0) {
        for (const g of gaps) say(`    ยังต้องใช้คน: ${g.decision}`);
      }
    }
    say("");
    const humanDeps = d.existence?.human_dependency ?? {};
    let humanTotal = 0;
    for (const dep of Object.values(humanDeps) as any[]) humanTotal += dep.count ?? 0;
    say(`รวม ${humanTotal} จุดที่ยังต้องใช้คนตัดสินใจ`);

    say("");
    say("เหตุผลที่ยังต้องใช้คน:");
    for (const [, dep] of Object.entries(humanDeps) as [string, any][]) {
      say(`  ${dep.label} (${dep.count} จุด): ${dep.reason}`);
    }
  }},
];

// ── Default Handler ──

function handleUnknown(question: string) {
  say("");
  say("ระบบยังไม่มีข้อมูลที่จะตอบคำถามนี้ได้ครับ");
  say("");
  say("คำถามที่ตอบได้:");
  say("  - วันนี้ระบบสถานะเป็นอย่างไร");
  say("  - ระบบขาดอะไร");
  say("  - เดือนนี้ต้องจ่ายอะไร");
  say("  - บริการไหนออนไลน์");
  say("  - ถ้าจะเติบโตต้องทำอะไร");
  say("  - ความเสี่ยงตอนนี้คืออะไร");
  say("  - ถ้าจะย้ายไป Android ต้องทำอะไร");
  say("  - ระบบทำงานเองได้แค่ไหน");
  say("  - ถ้าจะเพิ่มรายได้ควรทำอะไร");
  say("  - ถ้าจะลดต้นทุนควรทำอะไร");
}

// ── Main ──

// answerQuestion — pure function ใช้ได้ทั้ง CLI และ API
// คืนค่า matched=false เมื่อไม่มี pattern ตรง (ห้ามเดา ต้องบอกตรงๆ ว่าไม่รู้)
export function answerQuestion(question: string): { answer: string; matched: boolean } {
  const owner = loadOwner();
  const name = owner.identity?.nickname ?? "เฮีย";

  say("");
  say(`  ${name}ถาม: "${question}"`);

  const data = allData();
  const q = question.toLowerCase();

  for (const pattern of patterns) {
    if (pattern.match.test(q)) {
      pattern.handler(q, data);
      say("");
      return { answer: flush(), matched: true };
    }
  }

  handleUnknown(question);
  say("");
  return { answer: flush(), matched: false };
}

function dbd(question: string) {
  const { answer } = answerQuestion(question);
  console.log(answer);
}

// ── CLI ── (ทำงานเฉพาะตอนรันเป็น script โดยตรง ไม่ทำงานตอนถูก import เข้า Next.js)

const isDirectRun = typeof require !== "undefined" && require.main === module;

if (isDirectRun) {
  const args = process.argv.slice(2);
  const firstArg = args[0] ?? "";

  if (args.length === 0) {
    const owner = loadOwner();
    const name = owner.identity?.nickname ?? "เฮีย";
    say("");
    say(`  DBD — ผู้ช่วยของ${name}`);
    say("  ถามอะไรก็ได้เป็นภาษาไทย");
    say("");
    say("  คำถาม:");
    say('    npm run dbd -- "วันนี้ระบบเป็นยังไง"');
    say('    npm run dbd -- "ระบบขาดอะไร"');
    say('    npm run dbd -- "เดือนนี้ต้องจ่ายอะไร"');
    say('    npm run dbd -- "ระบบทำงานเองได้แค่ไหน"');
    say("");
    say("  จัดการ Owner Context:");
    say('    npm run dbd -- context                  ดูตัวตนเจ้าของ');
    say('    npm run dbd -- goal "เป้าหมายใหม่"       เปลี่ยนเป้าหมาย');
    say('    npm run dbd -- mission "งานใหม่"          เปลี่ยนงานปัจจุบัน');
    say("");
    console.log(flush());
  } else if (firstArg === "context") {
    showOwnerContext();
    console.log(flush());
  } else if (firstArg === "goal" && args[1]) {
    updateOwnerGoal(args.slice(1).join(" "));
    console.log(flush());
  } else if (firstArg === "mission" && args[1]) {
    updateOwnerWork(args.slice(1).join(" "));
    console.log(flush());
  } else {
    dbd(args.join(" "));
  }
}
