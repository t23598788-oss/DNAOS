import {
  CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_CONTRACT_ID,
  CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_SCHEMA_VERSION,
  CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_CONTRACT_VERSION,
  computeCircuitModelSubsystemIdentityDigest,
  createCircuitModelSubsystemIdentity,
  freezeCircuitModelSubsystemIdentity,
  validateCircuitModelSubsystemIdentity,
  type CircuitModelSubsystemIdentityV1,
} from "./circuit-model-subsystem-identity";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
let passed = 0; let failed = 0;
const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
function check(name: string, body: () => void): void { try { body(); passed++; console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); } }

const subsystemId = "subsystem-123e4567-e89b-12d3-a456-426614174000";
const make = (id = subsystemId): Readonly<CircuitModelSubsystemIdentityV1> => createCircuitModelSubsystemIdentity({ subsystem_id: id });

check("1. valid V1 identity accepted", () => assert(validateCircuitModelSubsystemIdentity(make()).valid, "valid identity rejected"));
check("2. correct schema accepted", () => assert(make().schema_version === CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_SCHEMA_VERSION, "schema changed"));
check("3. subsystem_kind locked", () => assert(make().subsystem_kind === "CIRCUIT_MODEL_SUBSYSTEM", "kind changed"));
check("4. role locked", () => assert(make().role === "PRIMARY", "role changed"));
check("5. valid opaque ID accepted", () => assert(make().subsystem_id === subsystemId, "opaque ID rejected"));
check("6. malformed ID rejected", () => assert(!validateCircuitModelSubsystemIdentity({ ...make(), subsystem_id: "primary-circuit" }).valid, "malformed ID accepted"));
check("7. constructor does not generate ID", () => { let threw = false; try { createCircuitModelSubsystemIdentity({ subsystem_id: undefined as unknown as string }); } catch { threw = true; } assert(threw, "missing ID was generated"); });
check("8. installation_id is not identity", () => assert(!("installation_id" in make()), "installation_id included"));
check("9. logical_name is not identity", () => assert(!("logical_name" in make()), "logical_name included"));
check("10. responsibility is not identity", () => assert(!("responsibility" in make()), "responsibility included"));
check("11. process/service fields are not identity", () => assert(!("process" in make()) && !("service_id" in make()) && !("port" in make()), "operational field included"));
check("12. route is not identity", () => assert(!("route" in make()), "route included"));
check("13. capability_id is not identity", () => assert(!("capability_id" in make()), "capability included"));
check("14. exact identity construction deterministic", () => assert(make().semantic_digest === make().semantic_digest, "identity is not deterministic"));
check("15. identity immutable", () => { const a = make(); assert(Object.isFrozen(a), "identity is mutable"); assert(freezeCircuitModelSubsystemIdentity(a) === a, "freeze not idempotent"); });
check("16. repeated record is semantically same", () => assert(make().semantic_digest === make(subsystemId).semantic_digest, "repeat changed semantics"));
check("17. same ID with conflicting kind is rejected", () => assert(!validateCircuitModelSubsystemIdentity({ ...make(), subsystem_kind: "CIRCUIT_MODEL_RUNTIME" }).valid, "conflicting kind accepted"));
check("18. identity does not enforce cardinality", () => assert(validateCircuitModelSubsystemIdentity(make()).valid && validateCircuitModelSubsystemIdentity(make("subsystem-123e4567-e89b-12d3-a456-426614174001")).valid, "identity constructor enforced topology"));
check("19. no SoftwareApplicationBoundary dependency", () => assert((CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_CONTRACT_ID as string) !== "dna-os/software-application-boundary", "application contract reused"));
check("20. no filesystem mutation API", () => assert(!Object.keys(make()).some((key) => key.includes("file") || key.includes("path")), "filesystem field appeared"));
check("21. no registry mutation API", () => assert(CIRCUIT_MODEL_SUBSYSTEM_IDENTITY_CONTRACT_VERSION === "1.0.0" && computeCircuitModelSubsystemIdentityDigest(make()).length === 64, "registry behavior appeared"));

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
