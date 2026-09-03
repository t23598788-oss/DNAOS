import {
  CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_CONTRACT_ID,
  CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_CONTRACT_VERSION,
  computeCircuitModelSubsystemCardinalityDigest,
  createCircuitModelSubsystemCardinality,
  evaluateCircuitModelSubsystemCardinality,
  freezeCircuitModelSubsystemCardinality,
  validateCircuitModelSubsystemCardinality,
  type CircuitModelSubsystemCardinalityV1,
} from "./circuit-model-subsystem-cardinality";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
let passed = 0;
let failed = 0;
const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
function check(name: string, body: () => void): void { try { body(); passed++; console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); } }

const make = (): Readonly<CircuitModelSubsystemCardinalityV1> => createCircuitModelSubsystemCardinality();

check("1. valid V1 declaration accepted", () => assert(validateCircuitModelSubsystemCardinality(make()).valid, "valid declaration rejected"));
check("2. parent_kind locked to INSTALLATION", () => assert(make().parent_kind === "INSTALLATION", "parent kind changed"));
check("3. subsystem_kind locked to CIRCUIT_MODEL_SUBSYSTEM", () => assert(make().subsystem_kind === "CIRCUIT_MODEL_SUBSYSTEM", "subsystem kind changed"));
check("4. role locked to PRIMARY", () => assert(make().role === "PRIMARY", "role changed"));
check("5. cardinality locked to ZERO_OR_ONE", () => assert(make().cardinality === "ZERO_OR_ONE", "cardinality changed"));
check("6. unknown parent rejected", () => assert(!validateCircuitModelSubsystemCardinality({ ...make(), parent_kind: "WORKSPACE" }).valid, "unknown parent accepted"));
check("7. unknown subsystem kind rejected", () => assert(!validateCircuitModelSubsystemCardinality({ ...make(), subsystem_kind: "CIRCUIT_MODEL_RUNTIME" }).valid, "unknown subsystem kind accepted"));
check("8. unknown role rejected", () => assert(!validateCircuitModelSubsystemCardinality({ ...make(), role: "AUXILIARY" }).valid, "unknown role accepted"));
check("9. unknown cardinality rejected", () => assert(!validateCircuitModelSubsystemCardinality({ ...make(), cardinality: "EXACTLY_ONE" }).valid, "unknown cardinality accepted"));
check("10. semantic digest deterministic", () => assert(make().semantic_digest === make().semantic_digest, "digest is not deterministic"));
check("11. key ordering does not alter digest", () => { const a = make(); const reordered = { cardinality: a.cardinality, role: a.role, subsystem_kind: a.subsystem_kind, parent_kind: a.parent_kind, contract_version: a.contract_version, contract_id: a.contract_id, schema_version: a.schema_version }; assert(computeCircuitModelSubsystemCardinalityDigest(reordered) === a.semantic_digest, "key ordering changed digest"); });
check("12. semantic change alters digest", () => { const a = make(); const changed = { ...a, contract_version: "1.0.1" as const } as unknown as Omit<CircuitModelSubsystemCardinalityV1, "semantic_digest">; assert(computeCircuitModelSubsystemCardinalityDigest(changed) !== a.semantic_digest, "semantic change did not alter digest"); });
check("13. declaration deeply immutable", () => { const a = make(); assert(Object.isFrozen(a), "declaration is mutable"); assert(freezeCircuitModelSubsystemCardinality(a) === a, "freeze was not idempotent"); });
check("14. zero primary instances valid", () => assert(evaluateCircuitModelSubsystemCardinality(0).status === "VALID", "zero instances invalid"));
check("15. one primary instance valid", () => assert(evaluateCircuitModelSubsystemCardinality(1).status === "VALID", "one instance invalid"));
check("16. two primary instances violate cardinality", () => assert(evaluateCircuitModelSubsystemCardinality(2).status === "CARDINALITY_VIOLATION", "two instances accepted"));
check("17. no concrete identity generated", () => { const a = make(); assert(!("installation_id" in a) && !("subsystem_id" in a), "concrete identity field generated"); });
check("18. no instance creation API", () => assert(!Object.keys(make()).some((key) => key.endsWith("_id") && key !== "contract_id"), "instance identity appeared"));
check("19. registry mutation absent", () => assert(CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_CONTRACT_ID === "dna-os/circuit-model-subsystem-cardinality" && CIRCUIT_MODEL_SUBSYSTEM_CARDINALITY_CONTRACT_VERSION === "1.0.0", "contract identity changed"));

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
