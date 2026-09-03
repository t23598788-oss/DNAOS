/**
 * หน้าที่: พิสูจน์ว่า Catalog Projection เป็น read-model จริง —
 * ไม่เขียนอะไร ไม่ยุบสถานะ downgrade เมื่อ provenance หาย และ agent-gateway
 * ไม่มีทางกลายเป็น projected executable
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildCapabilityCatalog, checkProvenance, RECORDED_CONTRACT_CANDIDATES, RECORDED_PARTIAL } from "../contract";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { pass++; console.log("  PASS  " + n); } else { fail++; console.log("  FAIL  " + n + (d ? "  -> " + d : "")); }
};

const CANON = join(__dirname, "..", "..", "registry-database", "data", "canonical");
const FILES = ["capabilities", "resources", "relationships", "evidence", "versions"];
const digest = () => FILES.map((f) => createHash("sha256").update(readFileSync(join(CANON, `${f}.jsonl`), "utf8")).digest("hex")).join("|");

console.log("\nNON-PERSISTENT / READ-ONLY");
const before = digest();
const a = buildCapabilityCatalog("2026-01-01T00:00:00.000Z");
const b = buildCapabilityCatalog("2026-01-01T00:00:00.000Z");
const after = digest();
ok("canonical ไม่ถูกแตะจากการคำนวณ projection", before === after);
ok("คำนวณซ้ำได้ผลเหมือนเดิม (deterministic)", JSON.stringify(a.rows) === JSON.stringify(b.rows));
ok("projection ไม่สร้างไฟล์ผลลัพธ์ใด",
  !existsSync(join(__dirname, "..", "data")) && !existsSync(join(__dirname, "..", "catalog.json")));

console.log("\nสามชั้นต้องแยกกัน ห้ามยุบ");
const s = a.summary;
console.log(`  registered=${s.registered} resolvable=${s.resolvable} canonical_exec=${s.canonical_executable} projected_exec=${s.projected_executable} union=${s.executable_union} runtime=${s.runtime_available}`);
ok("canonical_executable กับ projected_executable เป็นคนละตัวเลข", s.canonical_executable !== s.projected_executable);
ok("runtime_available <= projected_executable", s.runtime_available <= s.projected_executable);
ok("projected_executable <= registered", s.projected_executable <= s.registered);
ok("executable_union >= ทั้งสองฝั่ง",
  s.executable_union >= s.canonical_executable && s.executable_union >= s.projected_executable);

console.log("\nAGENT-GATEWAY — ปิด PARTIAL ด้วยหลักฐานราย surface (2026-09-01)");
{
  const ag = a.rows.find((r) => r.canonical_name === "agent-gateway");
  ok("agent-gateway อยู่ใน projection", Boolean(ag));
  ok("มี 2 invocation surface จริง", (ag?.invocation_surfaces.length ?? 0) === 2, JSON.stringify(ag?.invocation_surfaces));
  ok("แต่ละ surface มี provenance ของตัวเอง", (ag?.source_provenance.length ?? 0) === 2);
  const symbols = (ag?.source_provenance ?? []).map((p) => p.symbol).sort();
  ok("สอง surface ใช้คนละ entrypoint",
    JSON.stringify(symbols) === JSON.stringify(["setVoiceBridgeEnabled", "submitTask"]), JSON.stringify(symbols));
  ok("output ของสอง surface เป็นคนละชนิดจริง (Task vs EnabledState)",
    (ag?.source_provenance ?? []).some((p) => p.type_or_schema.includes("Promise<Task>")) &&
    (ag?.source_provenance ?? []).some((p) => p.type_or_schema.includes("=> EnabledState")));
  ok("สถานะเป็น COMPLETE เพราะทุก surface พิสูจน์ได้", ag?.source_proven_contract_status === "COMPLETE", String(ag?.source_proven_contract_status));
  ok("จึงเป็น projected_executable", ag?.projected_executable === true);
  ok("แต่ canonical ยังว่างเหมือนเดิม (ไม่ถูกยกระดับ)", ag?.canonical_contract_status === "EMPTY" && ag?.canonical_executable === false);
  ok("RECORDED_PARTIAL ว่างแล้ว", RECORDED_PARTIAL.length === 0, JSON.stringify(RECORDED_PARTIAL));
}

console.log("\nSURFACE COVERAGE — surface ที่ไม่มี contract ต้องทำให้ทั้ง capability ไม่ COMPLETE");
{
  ok("ปัจจุบันไม่มี capability ใดมี surface ที่ขาด contract", s.surfaces_without_contract === 0, String(s.surfaces_without_contract));
  const multi = a.rows.filter((r) => r.invocation_surfaces.length > 1);
  ok("capability ที่มีหลาย surface ถูกตรวจครบทุกเส้น",
    multi.every((r) => r.source_provenance.length >= r.invocation_surfaces.length),
    JSON.stringify(multi.map((r) => [r.canonical_name, r.invocation_surfaces.length, r.source_provenance.length])));
}

console.log("\nPROVENANCE — ทุก field ต้องมีที่มา");
{
  const projected = a.rows.filter((r) => r.projected_executable);
  ok("ทุกแถวที่ projected_executable มี provenance ไม่ว่าง", projected.every((r) => r.source_provenance.length > 0));
  ok("ทุก provenance มี source_location + symbol + type",
    projected.every((r) => r.source_provenance.every((p) => p.source_location && p.symbol && p.type_or_schema)));
  ok("ทุก provenance อ้าง evidence_reference กลับไปยังเอกสาร",
    projected.every((r) => r.source_provenance.every((p) => p.evidence_reference.includes("SEMANTIC_CANDIDATE_AND_CONTRACT_DISCOVERY"))));
  ok("provenance check ผ่านทุกตัวที่ projected", projected.every((r) => r.provenance_check.ok));
}

console.log("\nDOWNGRADE — ไม่มี SUCCESS ค้างจากอดีต");
{
  const real = RECORDED_CONTRACT_CANDIDATES[0];
  const brokenSource = checkProvenance({ ...real, entry_source: "connections/github/does-not-exist.ts" });
  ok("source หาย -> ไม่ผ่าน", !brokenSource.ok && brokenSource.reasons[0].startsWith("SOURCE_MISSING"));
  const brokenSymbol = checkProvenance({ ...real, entry_symbol: "symbolThatDoesNotExistAnywhere" });
  ok("symbol หาย -> ไม่ผ่าน", !brokenSymbol.ok && brokenSymbol.reasons.some((r) => r.startsWith("SYMBOL_MISSING")));
  const brokenType = checkProvenance({ ...real, input_types: ["TypeThatDoesNotExistAnywhere"] });
  ok("type ไม่อยู่ใน source แล้ว -> ไม่ผ่าน", !brokenType.ok && brokenType.reasons.some((r) => r.startsWith("TYPE_NOT_FOUND")));
  const brokenTest = checkProvenance({ ...real, provenance: [{ ...real.provenance[0], test: "connections/github/no-such.test.ts" }] });
  ok("test หาย -> ไม่ผ่าน", !brokenTest.ok && brokenTest.reasons.some((r) => r.startsWith("TEST_MISSING")));
  ok("provenance_failures ปัจจุบัน = 0", s.provenance_failures === 0, String(s.provenance_failures));
}

console.log("\nไม่เรียกของที่ derive ว่าเป็น canonical");
{
  const gh = a.rows.find((r) => r.canonical_name === "github-source-executor");
  ok("github projected_executable = true", gh?.projected_executable === true);
  ok("แต่ canonical_contract_status ยังเป็น EMPTY", gh?.canonical_contract_status === "EMPTY");
  ok("canonical_input_contract ยังว่างจริง", (gh?.canonical_input_contract.length ?? -1) === 0);
  ok("canonical_executable = false (ไม่ถูกยกระดับโดย projection)", gh?.canonical_executable === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
