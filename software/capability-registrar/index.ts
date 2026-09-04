/**
 * หน้าที่: Step 2 of `software/capability-registrar/` (Owner, 2026-08-19:
 * "ต่อจาก software/capability-registrar/ ที่มีอยู่ ห้ามสร้าง registry
 * คู่ขนานใหม่ ให้ทำ capability discovery/index ที่ query ได้จริงจาก
 * CapabilityMetadata และ evidence จริงของ repository"). This is the first
 * real, queryable index — every record is projected from
 * `control/command-router/capability-registry.ts`'s real, already-verified
 * `CAPABILITY_REGISTRY` (see that file's own `../ARCHITECTURE_DECISIONS.md`
 * `§CAPABILITY_REGISTRY_VERIFICATION` for how each entry's `health_status`
 * was itself verified against real source) — through its public
 * `contract.ts`, never its private `router.ts`/internal state, per
 * `governance/architecture-rules/CAPABILITY_FOLDER_LAW.md` ข้อ 9.
 *
 * This does NOT create a second registry — the capability index is a
 * read-only PROJECTION of `capability-registry.ts`'s existing data into
 * `./types.ts`'s `CapabilityMetadata` shape.
 * `control/command-router/current-capability-map.json`'s ~30-entry
 * hand-typed inventory was deliberately NOT used as a source — this
 * folder's own README already documents it as stale/ungenerated; using it
 * here would encode staleness into the very thing meant to replace it.
 *
 * LAZY, MEMOIZED (fixed 2026-08-21 — real incident, see
 * `permissions/write-gate/rules.ts`'s own header for the full account):
 * `getCapabilityIndex()` computes the projection on its FIRST REAL CALL,
 * caches it, and returns the same cached array on every call after —
 * never re-scans `listCapabilities()` more than once, same real content
 * an eager top-level `const` would have produced. This is NOT a second
 * registry and does not change what the index contains — it only moves
 * WHEN `listCapabilities()` (and therefore `control/command-router/`) is
 * first touched, from "the instant this module is loaded" to "the
 * instant a caller actually asks for the index." A module that reaches
 * back into `control/command-router/` at MODULE-LOAD time is real cycle
 * risk for any future eager importer inside command-router's own
 * transitive graph (confirmed: it crashed
 * `control/command-router/tests/router.test.ts` once already, via
 * command-router -> agent-gateway -> ai-write-adapter -> write-gate ->
 * [this file, if imported eagerly] -> command-router, still mid-load).
 * Merely importing this file — to obtain a function reference — is now
 * always safe regardless of import order, because nothing runs until
 * `getCapabilityIndex()` is actually CALLED, always at real runtime,
 * always after every module has finished loading.
 *
 * Input: none. `getCapabilityIndex()` reads `control/command-router/contract.ts`'s
 * `listCapabilities()` on its first real call only.
 * Output: `getCapabilityIndex`, `findByCapabilityId`, `findByOwnerFolder`,
 * `searchOverlap`.
 * Dependency ที่อนุญาต: ./types.ts, `../../control/command-router/contract.ts`
 * (public contract only).
 * สิ่งที่ห้ามแตะ: never call `listCapabilities()` anywhere in this file
 * except inside `getCapabilityIndex()`'s own lazy-init branch — a second
 * call site would defeat both the memoization and the cycle-safety this
 * fix exists for. Never set `PARENT_CAPABILITY` to anything other than
 * `"COMMAND_ROUTER"` here without new real evidence — every record
 * projected by this file comes from `capability-registry.ts`, whose real
 * dna-os-circuit node id is `COMMAND_ROUTER`
 * (`dna-os-circuit/definition/circuit.json`'s own `COMMAND_ROUTER` node,
 * `source_note`: "control/command-router/router.ts + capability-registry.ts").
 * Never fabricate `DATA_CLASS`/`DESTINATION`/`REQUIRED_CREDENTIAL` —
 * `capability-registry.ts`'s `CapabilityRegistration` shape has no such
 * fields; where the source genuinely doesn't say, this file says so
 * honestly instead of guessing.
 *
 * NOT_YET_BUILT (still, honestly): no File Intelligence scan wiring, no
 * writer back into `capability-registry.ts` or `circuit.json` — this
 * round only makes the READ side real and queryable, per Owner's Step 2
 * scope. `searchOverlap` is deliberately literal (folder-prefix string
 * comparison) — never fuzzy/semantic matching, so `permissions/write-gate/`
 * can treat its output as fact, not a guess.
 */

import type { CapabilityMetadata, CapabilityStatus, RoutableCapabilityRegistration } from "./types";

const UNRESOLVED_FOLDER_PREFIX = "UNKNOWN — ";

function dirnameOf(pathOrLiteral: string): string {
  if (!pathOrLiteral.includes("/")) {
    return `${UNRESOLVED_FOLDER_PREFIX}capability-registry.ts's "contract" field is "${pathOrLiteral}", not a real file path — no folder can be derived`;
  }
  const parts = pathOrLiteral.split("/");
  parts.pop();
  return `${parts.join("/")}/`;
}

/** `capability-registry.ts`'s health_status has 2 real values; `CapabilityMetadata.STATUS` has 9. This is the one honest projection: CONNECTED means the router can actually invoke it (matches CapabilityStatus's own "CONNECTED" definition verbatim); NOT_CONNECTED means only a real registry entry exists, matching CapabilityStatus's own "REGISTERED" definition verbatim — never invented in between. */
function mapHealthToStatus(healthStatus: RoutableCapabilityRegistration["health_status"]): CapabilityStatus {
  return healthStatus === "CONNECTED" ? "CONNECTED" : "REGISTERED";
}

function buildRecord(cap: RoutableCapabilityRegistration): CapabilityMetadata {
  return {
    SOFTWARE_ID: cap.capability_id,
    OWNER_FOLDER: dirnameOf(cap.contract),
    CAPABILITY_ID: cap.capability_id,
    // Real, provable parent — see this file's header. Every record here comes from
    // capability-registry.ts, whose own circuit.json node id is COMMAND_ROUTER.
    PARENT_CAPABILITY: "COMMAND_ROUTER",
    INGRESS: cap.supported_commands,
    // capability-registry.ts's CapabilityRegistration has no egress field — honestly empty, never invented.
    EGRESS: [],
    CONTRACT: cap.contract,
    RUNTIME_ENTRY: cap.endpoint.kind === "not_yet_built" ? null : (cap.endpoint.entry ?? null),
    DATA_CLASS: "not captured by control/command-router/capability-registry.ts's schema — CapabilityRegistration has no data-class field",
    REQUIRED_PERMISSION: cap.permission_requirement,
    // capability-registry.ts has no credential-reference field for any entry today.
    REQUIRED_CREDENTIAL: null,
    DESTINATION: "not captured by control/command-router/capability-registry.ts's schema — CapabilityRegistration has no destination field",
    EVIDENCE_SOURCE: ["control/command-router/capability-registry.ts"],
    STATUS: mapHealthToStatus(cap.health_status),
  };
}

let memoizedCapabilityIndex: readonly CapabilityMetadata[] | null = null;

/** Computed on first real call, memoized after — see this file's header. */
/**
 * รายการที่ผู้เรียกส่งเข้ามา — ทิศการพึ่งพาถูกกลับเมื่อ 2026-09-04
 *
 * เดิมไฟล์นี้ import listCapabilities() จาก control/command-router เอง ทำให้
 * ตัวตัดสินสิทธิ์พึ่งพา implementation ของสิ่งที่มันตัดสิน แยกออกจากกันไม่ได้
 * และเคยทำให้เกิด module-load cycle จริง
 *
 * ตอนนี้ DNA OS เป็นฝ่ายส่งรายการเข้ามาผ่าน setCapabilityRegistrations()
 * ถ้าไม่มีใครส่ง ดัชนีเป็นรายการว่าง — ไม่ใช่การเดา ไม่ใช่การไปดึงเอง
 */
let registrationsProvider: (() => readonly RoutableCapabilityRegistration[]) | null = null;

/**
 * ผู้เรียกส่ง "ตัวดึงข้อมูล" ไม่ใช่ข้อมูลสำเร็จรูป — ตั้งใจให้เป็น thunk
 * เพราะการเรียกทันทีตอนโหลดโมดูลทำให้เกิด module-load cycle จริง
 * (command-router -> registrar-bootstrap -> command-router ที่ยังโหลดไม่จบ)
 * ดัชนีจึงถูกคำนวณตอนใช้จริงครั้งแรกเท่านั้น เหมือนพฤติกรรมเดิมทุกประการ
 */
export function setCapabilityRegistrationsProvider(
  provider: () => readonly RoutableCapabilityRegistration[],
): void {
  registrationsProvider = provider;
  memoizedCapabilityIndex = null;
}

/** ส่งข้อมูลสำเร็จรูปเข้ามาโดยตรง — สำหรับผู้เรียกที่มีข้อมูลอยู่แล้ว */
export function setCapabilityRegistrations(registrations: readonly RoutableCapabilityRegistration[]): void {
  setCapabilityRegistrationsProvider(() => registrations);
}

export function getCapabilityIndex(): readonly CapabilityMetadata[] {
  if (memoizedCapabilityIndex === null) {
    memoizedCapabilityIndex = (registrationsProvider === null ? [] : registrationsProvider()).map(buildRecord);
  }
  return memoizedCapabilityIndex;
}

export function findByCapabilityId(capabilityId: string): CapabilityMetadata | undefined {
  return getCapabilityIndex().find((c) => c.CAPABILITY_ID === capabilityId);
}

export function findByOwnerFolder(ownerFolder: string): CapabilityMetadata | undefined {
  return getCapabilityIndex().find((c) => c.OWNER_FOLDER === ownerFolder);
}

function normalizeFolder(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

/**
 * Literal folder-prefix overlap only — real fact-checkable, never a
 * semantic/fuzzy guess. A record whose `OWNER_FOLDER` could not be
 * resolved to a real path (see `dirnameOf` above) is never matched — an
 * unresolved folder is not evidence of overlap either way.
 */
export function searchOverlap(targetPath: string, index: readonly CapabilityMetadata[] = getCapabilityIndex()): readonly CapabilityMetadata[] {
  const target = normalizeFolder(targetPath);
  return index.filter((c) => {
    if (c.OWNER_FOLDER.startsWith(UNRESOLVED_FOLDER_PREFIX)) return false;
    const folder = normalizeFolder(c.OWNER_FOLDER);
    return target === folder || target.startsWith(folder) || folder.startsWith(target);
  });
}
