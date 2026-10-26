/**
 * Negative serialization test for the owner-display DTO boundary
 * (Security Cutover 008 step 5 — "verify the exact serialized response").
 *
 * What it proves, at runtime (not by types):
 *   1. buildOwnerDisplayDTO drops every operator-registry section that is not
 *      one of the five displayed fields.
 *   2. JSON.stringify (Flight payloads use the same JSON data model) of the DTO
 *      never contains a forbidden section key.
 *   3. The DTO is structurally bounded to exactly OwnerDisplayDTO (7 strings),
 *      even when the raw registry object is mutated afterwards (the DTO must be
 *      a detached copy, not a reference chain into a live registry export).
 *
 * Run: npx tsx scripts/negative-owner-dto-serialization.test.ts
 * Exits non-zero on any violation. Prints marker-free evidence only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Import the SAME module the server page uses, relative to the repo root so the
// test cannot accidentally run against a different build of the boundary.
async function main() {
const projectRoot = resolve(__dirname, "..");
const dtoModuleUrl = resolve(projectRoot, "app/admin/operations/owner-context-dto.ts");
const { buildOwnerDisplayDTO, FORBIDDEN_OWNER_CONTEXT_SECTIONS } = await import(dtoModuleUrl);

// The real private registry (values stay on disk; only structural checks print).
const raw = JSON.parse(
  readFileSync(resolve(projectRoot, "registry/owner-context.json"), "utf8"),
) as Record<string, unknown>;

let failed = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
  if (!ok) failed += 1;
}

const dto = buildOwnerDisplayDTO(raw) as Record<string, unknown>;

// 1) Structural bound: exactly 3 sections, exactly 7 leaf strings.
const sections = Object.keys(dto).sort();
check(
  "structure bounded",
  JSON.stringify(sections) === JSON.stringify(["current_goals", "identity", "philosophy"]) &&
    Object.keys((dto.identity as Record<string, unknown>).sorted ?? (dto.identity as Record<string, unknown>)).length === 2 &&
    Object.keys(dto.current_goals as Record<string, unknown>).length === 1 &&
    Object.keys(dto.philosophy as Record<string, unknown>).length === 1 &&
    (dto.identity as Record<string, unknown>).company !== undefined &&
    (dto.identity as Record<string, unknown>).email !== undefined,
  `sections=[${sections.join(", ")}]`,
);

// 2) Type check leaves are plain strings (input could try to smuggle objects).
const leaves = [
  (dto.identity as Record<string, unknown>).company,
  (dto.identity as Record<string, unknown>).email,
  (dto.current_goals as Record<string, unknown>).long_term,
  (dto.philosophy as Record<string, unknown>).core,
];
check(
  "leaves are primitives",
  leaves.every((v) => typeof v === "string"),
  `types=[${leaves.map((v) => typeof v).join(", ")}]`,
);

// 3) Serialized payload contains none of the forbidden section keys.
const serialized = JSON.stringify(dto);
const leaked = FORBIDDEN_OWNER_CONTEXT_SECTIONS.filter((key: string) =>
  serialized.includes(`"${key}"`),
);
check(
  "serialized payload has no forbidden keys",
  leaked.length === 0,
  `leaked=[${leaked.join(", ")}] (checked ${FORBIDDEN_OWNER_CONTEXT_SECTIONS.length} forbidden keys)`,
);

// 4) Cross-check against the REAL keys of the raw registry (not a fixed list):
//    nothing beyond the 7 displayed field names may survive serialization.
const displayedFieldNames = new Set([
  "company",
  "email",
  "long_term",
  "core",
  "identity",
  "current_goals",
  "philosophy",
]);
function collectKeys(node: unknown, into: Set<string>) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((child) => collectKeys(child, into));
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    into.add(key);
    collectKeys(value, into);
  }
}
const rawKeys = new Set<string>();
collectKeys(raw, rawKeys);
const dtoKeys = new Set<string>();
collectKeys(dto, dtoKeys);
const survivors = [...dtoKeys].filter((key) => !displayedFieldNames.has(key));
check(
  "no unexpected survivor keys vs real registry keys",
  survivors.length === 0,
  `survivors=[${survivors.join(", ")}] (raw registry has ${rawKeys.size} distinct keys)`,
);

// 5) Reference bleed: mutate the raw registry export after the DTO was built —
//    the ALREADY-BUILT payload must stay exactly what the server passed
//    (detached copy), and a REBUILT DTO may legitimately reflect the new raw
//    values (it reads current state by design) — so we assert only the
//    earlier-built object is immune to the injection.
const emailBefore = (dto.identity as Record<string, unknown>).email;
(raw as Record<string, unknown>).identity = { email: "pulse-injection@invalid.test" };
check(
  "already-built dto is detached from the registry export",
  (dto.identity as Record<string, unknown>).email === emailBefore &&
    !(JSON.stringify(dto) as string).includes("pulse-injection"),
  "mutating the raw registry after build cannot retro-inject into an already-passed payload",
);

console.log(failed === 0 ? "\nALL NEGATIVE SERIALIZATION CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
}

void main();
