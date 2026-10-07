import {
  createLocalInstallationCeremonyBoundary,
  enterLocalInstallationCeremony,
  validateLocalInstallationCeremonyBoundary,
  validateLocalInstallationCeremonyInvocation,
  type LocalInstallationCeremonyInvocationV1,
} from "./ceremony";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
let passed = 0; let failed = 0;
const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };
function check(name: string, body: () => void): void { try { body(); passed++; console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`); } }

const invocation = (): LocalInstallationCeremonyInvocationV1 => ({ schema_version: "LOCAL_INSTALLATION_CEREMONY_V1", operation: "INITIALIZE_INSTALLATION", authority_basis: "ONE_TIME_LOCAL_INSTALLATION_BOOTSTRAP_AXIOM", invocation_mode: "EXPLICIT_LOCAL_DIRECT_EXECUTION" });

check("1. valid explicit local invocation accepted", () => assert(validateLocalInstallationCeremonyInvocation(invocation()).valid, "invocation rejected"));
check("2. exact authority basis accepted", () => assert(validateLocalInstallationCeremonyInvocation(invocation()).valid, "authority basis rejected"));
check("3. unknown authority basis rejected", () => assert(!validateLocalInstallationCeremonyInvocation({ ...invocation(), authority_basis: "owner" }).valid, "unknown basis accepted"));
check("4. operation locked", () => assert(!validateLocalInstallationCeremonyInvocation({ ...invocation(), operation: "BOOTSTRAP_OWNER" }).valid, "unknown operation accepted"));
check("5. invocation mode locked", () => assert(!validateLocalInstallationCeremonyInvocation({ ...invocation(), invocation_mode: "HTTP" }).valid, "non-local mode accepted"));
check("6. missing schema rejected", () => { const { schema_version, ...missing } = invocation(); assert(!validateLocalInstallationCeremonyInvocation(missing).valid, "missing schema accepted"); });
check("7. remote invocation rejected", () => assert(!validateLocalInstallationCeremonyInvocation({ ...invocation(), caller: "remote" }).valid, "remote caller accepted"));
check("8. HTTP invocation rejected", () => assert(!validateLocalInstallationCeremonyInvocation({ ...invocation(), transport: "HTTP" }).valid, "HTTP caller accepted"));
check("9. Agent invocation rejected", () => assert(!validateLocalInstallationCeremonyInvocation({ ...invocation(), agent_id: "agent-1" }).valid, "agent caller accepted"));
check("10. AI invocation rejected", () => assert(!validateLocalInstallationCeremonyInvocation({ ...invocation(), ai_provider: "provider" }).valid, "AI caller accepted"));
check("11. owner strings are not authority roots", () => assert(!validateLocalInstallationCeremonyInvocation({ ...invocation(), authority_basis: "identity-deadboard-owner" }).valid, "owner string accepted"));
check("12. identity-deadboard-owner rejected", () => assert(!validateLocalInstallationCeremonyInvocation({ ...invocation(), requester_identity: "identity-deadboard-owner" }).valid, "owner identity accepted"));
check("13. Supabase identity rejected", () => assert(!validateLocalInstallationCeremonyInvocation({ ...invocation(), principal_id: "supabase-123" }).valid, "Supabase identity accepted"));
check("14. valid entry returns NOT_READY", () => assert(enterLocalInstallationCeremony(invocation()).status === "NOT_READY", "entry armed or accepted as initialized"));
check("15. invocation does not generate installation_id", () => assert(!("installation_id" in enterLocalInstallationCeremony(invocation())), "installation ID generated"));
check("16. invocation has no filesystem result", () => assert(!("path" in enterLocalInstallationCeremony(invocation())), "filesystem was accessed"));
check("17. invocation has no write result", () => assert(enterLocalInstallationCeremony(invocation()).reason === "CEREMONY_EXECUTION_DISARMED", "write path reached"));
check("18. invocation creates no Owner", () => assert(!("owner_id" in enterLocalInstallationCeremony(invocation())), "Owner created"));
check("19. invocation grants no subsystem authority", () => assert(!("subsystem_id" in enterLocalInstallationCeremony(invocation())), "subsystem authority granted"));
check("20. boundary declaration deterministic", () => assert(createLocalInstallationCeremonyBoundary().semantic_digest === createLocalInstallationCeremonyBoundary().semantic_digest, "boundary changed"));
check("21. boundary immutable", () => { const b = createLocalInstallationCeremonyBoundary(); assert(Object.isFrozen(b) && validateLocalInstallationCeremonyBoundary(b).valid, "boundary mutable or invalid"); });
check("22. no network route/listener", () => assert(!("port" in createLocalInstallationCeremonyBoundary()) && !("route" in createLocalInstallationCeremonyBoundary()), "network surface appeared"));
check("23. module is disarmed", () => assert(createLocalInstallationCeremonyBoundary().execution_armed === false, "ceremony armed"));

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
