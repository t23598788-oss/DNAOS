/**
 * หน้าที่: ตอบคำถามเดียว สำหรับทุก capability ใน /graph/system —
 * "ตอนมันทำงานจริง มันรายงาน observation ออกมาเองหรือเปล่า"
 *
 * เป็นการอ่าน source อย่างเดียว ไม่ยิง capability ไหน ไม่สร้าง event ไม่แตะ
 * topology ทุกคำตอบมาจากไฟล์ที่มีอยู่จริง และทุกการจำแนกอ้าง call site ได้
 *
 * ทำไมต้องดูที่ต้นทาง: joint-monitor เป็นแค่ปลายทาง ถ้า capability ไม่เรียก
 * `reportJoint` เองตอนทำงาน ต่อให้ transport สมบูรณ์แค่ไหนก็จะไม่มีอะไรไหลมา
 * ตลอดกาล — 95% ของ node ที่ไม่มี observation ไม่ได้เกิดจากเครื่องมือไม่พอ
 *
 * เกณฑ์จำแนก ทุกข้อพิสูจน์จากไฟล์:
 *   INSTRUMENTED           มี emit call site ในโค้ดที่ไม่ใช่เทสต์ และครอบคลุมทั้ง
 *                          ทางสำเร็จและทางล้มเหลว (มี emit ในบล็อก catch/error
 *                          หรือ emit ที่ส่ง status ล้มเหลว)
 *   PARTIALLY_INSTRUMENTED มี emit แต่ไม่ครบทาง เช่น มีเฉพาะทางสำเร็จ หรือมี
 *                          เฉพาะในเทสต์
 *   NOT_INSTRUMENTED       มีโค้ดที่รันได้ แต่ไม่มี emit เลย
 *   NOT_EXECUTABLE         ไม่มี surface ที่รันได้ (มีแต่ type/README/data)
 *   UNKNOWN                อ่านโฟลเดอร์ไม่ได้
 *
 * Usage: npx tsx software/live-census/tests/instrumentation-census.ts
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();

/**
 * สิ่งที่นับว่าเป็น "การรายงาน observation ออกไปนอก capability ตัวเอง"
 *
 * saveEvidence ไม่อยู่ในรายการนี้โดยตั้งใจ: มันเขียนลง evidence store ของ
 * agent-gateway ซึ่งเป็นคนละ transport กับ joint-monitor และไม่ไหลเข้า SSE →
 * graph การนับรวมจะทำให้ capability ที่เขียน evidence อย่างเดียวดูเหมือนมองเห็นได้
 * ทั้งที่ Workspace ไม่มีวันเห็นมันเลย
 */
const EMIT_PATTERNS: readonly { id: string; pattern: RegExp; reaches_graph: boolean }[] = [
  { id: "reportJoint", pattern: /\breportJoint\s*\(/, reaches_graph: true },
  { id: "reportViolation", pattern: /\breportViolation\s*\(/, reaches_graph: true },
  { id: "emitSystemEvent", pattern: /\bemitSystemEvent\s*\(/, reaches_graph: true },
  { id: "POST /joints", pattern: /["'`][^"'`]*\/joints["'`]/, reaches_graph: true },
];

const CODE_EXT = /\.(ts|mjs|js|py)$/;
const TEST_HINT = /(^|\/)(tests?|__tests__)(\/|$)|\.test\.|\.spec\./;
const SKIP_DIRS = new Set(["node_modules", ".git", "data", "evidence", "migrations", "docs", "reports"]);

interface Finding {
  file: string;
  line: number;
  primitive: string;
  in_test: boolean;
  in_catch: boolean;
  text: string;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    let s;
    try { s = statSync(abs); } catch { continue; }
    if (s.isDirectory()) walk(abs, out);
    else if (CODE_EXT.test(entry)) out.push(abs);
  }
  return out;
}

/**
 * emit นี้อยู่ในเส้นทางความล้มเหลวหรือไม่ — ดูจากบริบท 12 บรรทัดก่อนหน้า
 * ไม่ใช่การพิสูจน์เชิงตรรกะ แต่เป็นหลักฐานที่อ่านได้และตรวจซ้ำได้
 */
function nearFailurePath(lines: readonly string[], index: number): boolean {
  const window = lines.slice(Math.max(0, index - 12), index + 3).join("\n");
  return /\bcatch\s*[({]|\.catch\(|FAIL|FAILED|BLOCKED|ERROR|error\b|reject/i.test(window);
}

function scanFolder(sourcePath: string): { findings: Finding[]; codeFiles: number; nonTestCode: number } {
  const abs = join(REPO_ROOT, sourcePath);
  const files = walk(abs);
  const findings: Finding[] = [];
  let nonTestCode = 0;
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    const isTest = TEST_HINT.test(rel);
    if (!isTest) nonTestCode += 1;
    let content: string;
    try { content = readFileSync(file, "utf8"); } catch { continue; }
    const lines = content.split("\n");
    lines.forEach((line, i) => {
      // คอมเมนต์ไม่ใช่การเรียกจริง — การนับคอมเมนต์เป็น instrumentation คือ
      // การอ่านความตั้งใจว่าเป็นพฤติกรรม
      const stripped = line.replace(/^\s*(\/\/|\*|#).*$/, "");
      for (const emit of EMIT_PATTERNS) {
        if (emit.pattern.test(stripped)) {
          findings.push({
            file: rel, line: i + 1, primitive: emit.id, in_test: isTest,
            in_catch: nearFailurePath(lines, i), text: line.trim().slice(0, 90),
          });
        }
      }
    });
  }
  return { findings, codeFiles: files.length, nonTestCode };
}

/** จุดที่ควร emit — หา export ที่เป็นฟังก์ชันจริงใน contract/entrypoint */
function executionBoundary(sourcePath: string): { entrypoint: string | null; exports: string[] } {
  for (const candidate of ["contract.ts", "index.ts", "server.ts", "cli.ts"]) {
    const abs = join(REPO_ROOT, sourcePath, candidate);
    if (!existsSync(abs)) continue;
    let content: string;
    try { content = readFileSync(abs, "utf8"); } catch { continue; }
    const named = [...content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]);
    const reexported = [...content.matchAll(/export\s*\{\s*([^}]+)\}/g)]
      .flatMap((m) => m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()))
      .filter((s) => s && !s.startsWith("type "));
    return { entrypoint: `${sourcePath}/${candidate}`, exports: [...new Set([...named, ...reexported])].slice(0, 8) };
  }
  return { entrypoint: null, exports: [] };
}

function main(): void {
  const graphPath = join(REPO_ROOT, "..", "..", "tmp", "graph.json");
  const graphFile = existsSync("/tmp/graph.json") ? "/tmp/graph.json" : graphPath;
  const graph = JSON.parse(readFileSync(graphFile, "utf8")) as {
    nodes: { id: string; type: string; name: string; source_path: string | null }[];
  };

  const buckets: Record<string, { node: string; path: string; detail: string; boundary?: string; exports?: string[] }[]> = {
    INSTRUMENTED: [], PARTIALLY_INSTRUMENTED: [], NOT_INSTRUMENTED: [], NOT_EXECUTABLE: [], UNKNOWN: [],
  };

  for (const node of graph.nodes) {
    if (node.type !== "CAPABILITY") continue;
    const sourcePath = node.source_path;
    if (!sourcePath) { buckets.UNKNOWN.push({ node: node.id, path: "(none)", detail: "node ไม่มี source_path" }); continue; }
    if (!existsSync(join(REPO_ROOT, sourcePath))) {
      buckets.UNKNOWN.push({ node: node.id, path: sourcePath, detail: "โฟลเดอร์ไม่มีใน checkout นี้" });
      continue;
    }
    const { findings, codeFiles, nonTestCode } = scanFolder(sourcePath);
    const boundary = executionBoundary(sourcePath);

    if (codeFiles === 0 || (nonTestCode === 0)) {
      buckets.NOT_EXECUTABLE.push({ node: node.id, path: sourcePath, detail: `${codeFiles} code file, ${nonTestCode} non-test` });
      continue;
    }
    const real = findings.filter((f) => !f.in_test);
    const inTestsOnly = real.length === 0 && findings.length > 0;
    if (real.length === 0 && !inTestsOnly) {
      buckets.NOT_INSTRUMENTED.push({
        node: node.id, path: sourcePath,
        detail: `${nonTestCode} non-test code file, 0 emit call site`,
        boundary: boundary.entrypoint ?? "(no contract.ts/index.ts)",
        exports: boundary.exports,
      });
      continue;
    }
    if (inTestsOnly) {
      buckets.PARTIALLY_INSTRUMENTED.push({
        node: node.id, path: sourcePath,
        detail: `emit ปรากฏเฉพาะในเทสต์ (${findings.length} จุด) production path ไม่ emit`,
        boundary: boundary.entrypoint ?? "(no contract.ts/index.ts)",
      });
      continue;
    }
    const failurePath = real.some((f) => f.in_catch);
    if (failurePath) {
      buckets.INSTRUMENTED.push({
        node: node.id, path: sourcePath,
        detail: `${real.length} emit call site (${[...new Set(real.map((f) => f.primitive))].join(", ")}) ครอบคลุมเส้นทางล้มเหลว — ${real[0].file}:${real[0].line}`,
      });
    } else {
      buckets.PARTIALLY_INSTRUMENTED.push({
        node: node.id, path: sourcePath,
        detail: `${real.length} emit call site แต่ไม่พบ emit ในเส้นทางล้มเหลว — ${real[0].file}:${real[0].line}`,
        boundary: boundary.entrypoint ?? "(no contract.ts/index.ts)",
      });
    }
  }

  const total = Object.values(buckets).reduce((n, b) => n + b.length, 0);
  console.log("=".repeat(96));
  console.log("SOURCE INSTRUMENTATION GAP MAP — static source analysis only, nothing executed");
  console.log("=".repeat(96));
  console.log(`CAPABILITY nodes scanned: ${total}\n`);
  for (const [name, rows] of Object.entries(buckets)) {
    console.log(`${name.padEnd(24)} ${String(rows.length).padStart(4)}   (${Math.round(rows.length / total * 100)}%)`);
  }

  console.log("\n--- INSTRUMENTED ---");
  for (const r of buckets.INSTRUMENTED) console.log(`  ${r.path.padEnd(38)} ${r.detail}`);

  console.log("\n--- PARTIALLY_INSTRUMENTED ---");
  for (const r of buckets.PARTIALLY_INSTRUMENTED) console.log(`  ${r.path.padEnd(38)} ${r.detail}`);

  console.log("\n--- NOT_EXECUTABLE ---");
  for (const r of buckets.NOT_EXECUTABLE) console.log(`  ${r.path.padEnd(38)} ${r.detail}`);

  console.log("\n--- UNKNOWN ---");
  for (const r of buckets.UNKNOWN) console.log(`  ${r.path.padEnd(38)} ${r.detail}`);

  console.log(`\n--- NOT_INSTRUMENTED (${buckets.NOT_INSTRUMENTED.length}) — execution boundary and where an emit belongs ---`);
  for (const r of buckets.NOT_INSTRUMENTED.slice(0, 40)) {
    console.log(`  ${r.path}`);
    console.log(`      boundary : ${r.boundary}`);
    console.log(`      exports  : ${(r.exports ?? []).join(", ") || "(none found)"}`);
  }
  if (buckets.NOT_INSTRUMENTED.length > 40) console.log(`  ... และอีก ${buckets.NOT_INSTRUMENTED.length - 40} รายการ`);
}

main();
