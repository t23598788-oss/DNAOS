/**
 * หน้าที่: สร้าง forward lock ของ CHIP 2 จากสถานะปัจจุบันที่ตรวจแล้ว
 *
 * ทำไมเป็น "forward" ไม่ใช่การพิสูจน์ย้อนหลัง: ไฟล์ chip2-package-model.json
 * ไม่เคยถูก track ใน git ไม่มี lock ไม่มี hash บันทึกไว้ที่ไหนเลย จึงไม่มีทาง
 * พิสูจน์ได้ว่าสถานะวันนี้เท่ากับวันที่สร้าง lock นี้จึงตรึงไปข้างหน้าเท่านั้น
 * และบันทึกไว้ตรง ๆ ว่า historical_immutability = UNKNOWN — ห้ามอ่านไฟล์นี้
 * เป็นหลักฐานว่าอดีตไม่ถูกแก้
 *
 * Usage: npx tsx software/system-graph/chip-interface/make-chip2-forward-lock.ts [--verify]
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DATA = join(__dirname, "..", "data");
const PKG = join(DATA, "chip2-package-model.json");
const IFACE = join(DATA, "chip2-external-interface.json");
const LOCK = join(DATA, "chip2-physical-lock.json");
const LOCK_VERSION = 1;

const sha = (v: unknown) => createHash("sha256").update(
  typeof v === "string" ? v : JSON.stringify(v)).digest("hex");

/** ส่วนที่ถือว่าเป็น "ภายในชิป" — เรขาคณิตและ identity ที่ห้ามขยับ */
function internalOf(pkg: any) {
  return {
    GEOMETRY: pkg.GEOMETRY,
    MEMBERS: pkg.MEMBERS,
    INTERNAL_PORTS: pkg.INTERNAL_PORTS,
    PACKAGE_PINS: pkg.PACKAGE_PINS,
    TRACES: pkg.TRACES,
    VIAS: pkg.VIAS,
    ROUTING_LAYERS: pkg.ROUTING_LAYERS,
  };
}

function compute() {
  const raw = readFileSync(PKG, "utf8");
  const pkg = JSON.parse(raw);
  const iface = existsSync(IFACE) ? JSON.parse(readFileSync(IFACE, "utf8")) : null;
  return {
    PACKAGE_FILE_HASH: sha(raw),
    INTERNAL_HASH: sha(internalOf(pkg)),
    MODEL_COUNT: pkg.MEMBERS.length,
    PORT_COUNT: (pkg.INTERNAL_PORTS ?? []).length + (pkg.PACKAGE_PINS ?? []).length,
    INTERNAL_PORT_COUNT: (pkg.INTERNAL_PORTS ?? []).length,
    PACKAGE_PIN_COUNT: (pkg.PACKAGE_PINS ?? []).length,
    TRACE_COUNT: (pkg.TRACES ?? []).length,
    VIA_COUNT: (pkg.VIAS ?? []).length,
    CONNECTION_INTERFACE_IDS: (iface?.PORTS ?? iface?.ports ?? [])
      .map((p: any) => p.PORT_ID ?? p.port_id).filter(Boolean).sort(),
  };
}

function main() {
  const verifyOnly = process.argv.includes("--verify");
  const now = compute();

  if (verifyOnly) {
    if (!existsSync(LOCK)) { console.log("NO_LOCK_FILE"); process.exit(1); }
    const lock = JSON.parse(readFileSync(LOCK, "utf8"));
    const fields = ["PACKAGE_FILE_HASH", "INTERNAL_HASH", "MODEL_COUNT", "PORT_COUNT",
                    "TRACE_COUNT", "VIA_COUNT"] as const;
    const diffs = fields.filter((f) => JSON.stringify((lock as any)[f]) !== JSON.stringify((now as any)[f]));
    const idsMatch = JSON.stringify(lock.CONNECTION_INTERFACE_IDS) === JSON.stringify(now.CONNECTION_INTERFACE_IDS);
    console.log(JSON.stringify({
      SECOND_CHIP_FORWARD_LOCK_MATCH: diffs.length === 0 && idsMatch ? "YES" : "NO",
      MISMATCHED_FIELDS: diffs, CONNECTION_INTERFACE_IDS_MATCH: idsMatch,
      RECOMPUTED: now,
    }, null, 1));
    process.exit(diffs.length === 0 && idsMatch ? 0 : 1);
  }

  if (existsSync(LOCK)) { console.log("LOCK_ALREADY_EXISTS — ไม่เขียนทับ ใช้ --verify เพื่อตรวจ"); process.exit(1); }
  const lock = {
    schema_version: 1,
    LOCK_VERSION,
    CHIP_ID: "chip:agent-runtime",
    LOCK_CREATED_AT: new Date().toISOString(),
    LOCK_REASON: "Owner approved a forward baseline after verification showed no historical before-hash exists for CHIP 2",
    baseline_origin: "forward baseline established after historical baseline was unavailable",
    historical_immutability: "UNKNOWN",
    forward_lock: "ACTIVE",
    ...now,
    CANONICAL_SOURCE_PATHS: [
      "software/system-graph/data/chip2-package-model.json",
      "software/system-graph/data/chip2-external-interface.json",
    ],
    HASH_METHOD: {
      PACKAGE_FILE_HASH: "sha256 ของไบต์ทั้งไฟล์ chip2-package-model.json",
      INTERNAL_HASH: "sha256 ของ JSON.stringify({GEOMETRY,MEMBERS,INTERNAL_PORTS,PACKAGE_PINS,TRACES,VIAS,ROUTING_LAYERS})",
    },
  };
  writeFileSync(LOCK, `${JSON.stringify(lock, null, 1)}\n`);
  console.log(JSON.stringify({ WROTE: LOCK, ...now }, null, 1));
}
main();
