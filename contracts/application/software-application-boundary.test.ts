import {
  createSoftwareApplicationBoundary,
  computeSoftwareApplicationBoundaryDigest,
  freezeSoftwareApplicationBoundary,
  normalizeLogicalRoute,
  validateSoftwareApplicationBoundary,
  type SoftwareApplicationBoundaryV1,
} from "./software-application-boundary";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
let passed = 0; let failed = 0;
const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
function check(name: string, body: () => void): void { try { body(); passed++; console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); } }

const make = (routes: readonly (string | { route: string })[] = ["/", "/system-graph", "/evidence-trace"]): Readonly<SoftwareApplicationBoundaryV1> => createSoftwareApplicationBoundary({ application_id: "app://example/dna-os-circuit", boundary_kind: "LOGICAL_APPLICATION", logical_name: "Example Circuit", runtime_entrypoint: "dna-os-circuit/runtime/start.ts", lifecycle_boundary: "dna-os-circuit logical runtime boundary", owned_route_refs: routes });

check("1. valid LOGICAL_APPLICATION declaration accepted", () => assert(validateSoftwareApplicationBoundary(make()).valid, "valid declaration rejected"));
check("2. missing application_id rejected", () => assert(!validateSoftwareApplicationBoundary({ ...make(), application_id: "" }).valid, "missing application_id accepted"));
check("3. empty application_id rejected", () => assert(!validateSoftwareApplicationBoundary({ ...make(), application_id: "   " }).valid, "empty application_id accepted"));
check("4. runtime/process fields are not application identity", () => { const a = make(); const b = make(); assert(a.application_id === b.application_id && a.application_id !== a.runtime_entrypoint, "physical field became identity"); });
check("5. canonical root route remains /", () => assert(normalizeLogicalRoute("/") === "/" && normalizeLogicalRoute("root") === "/root", "root normalization incorrect"));
check("6. system-graph canonicalization", () => assert(normalizeLogicalRoute("system-graph") === "/system-graph", "system-graph normalization incorrect"));
check("7. trailing slash equivalence", () => assert(normalizeLogicalRoute("/system-graph/") === "/system-graph", "trailing slash not normalized"));
check("8. query exclusion", () => assert(normalizeLogicalRoute("/system-graph?x=1") === "/system-graph", "query not excluded"));
check("9. fragment exclusion", () => assert(normalizeLogicalRoute("/system-graph#details") === "/system-graph", "fragment not excluded"));
check("10. duplicate canonical route rejected", () => { let rejected = false; try { make(["/system-graph", "/system-graph/"]); } catch { rejected = true; } assert(rejected, "duplicate route accepted"); });
check("11. digest stable across key ordering", () => { const a = make(); const reordered = { schema_version: a.schema_version, application_id: a.application_id, boundary_kind: a.boundary_kind, logical_name: a.logical_name, runtime_entrypoint: a.runtime_entrypoint, lifecycle_boundary: a.lifecycle_boundary, owned_route_refs: [...a.owned_route_refs], }; assert(computeSoftwareApplicationBoundaryDigest(reordered) === a.semantic_digest, "key ordering changed digest"); });
check("12. digest stable across route input ordering", () => assert(make(["/evidence-trace", "/", "/system-graph"]).semantic_digest === make().semantic_digest, "route input order changed digest"));
check("13. semantic route ownership change changes digest", () => assert(make(["/", "/system-graph"]).semantic_digest !== make().semantic_digest, "route ownership change did not change digest"));
check("14. declaration deep immutable", () => { const a = make(); const frozen = freezeSoftwareApplicationBoundary(a); assert(Object.isFrozen(frozen) && Object.isFrozen(frozen.owned_route_refs) && Object.isFrozen(frozen.owned_route_refs[0]), "declaration not deeply frozen"); });
check("15. invalid boundary_kind rejected", () => assert(!validateSoftwareApplicationBoundary({ ...make(), boundary_kind: "SERVICE_GROUP" }).valid, "invalid boundary kind accepted"));

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
