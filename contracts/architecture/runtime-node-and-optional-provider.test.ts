import {
  MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE,
  PORTABILITY_SEQUENCE_AFTER_VOCABULARY,
  RUNTIME_NODE_AND_OPTIONAL_PROVIDER_CONTRACT_ID,
  isOptionalComputeProvider,
  lookupProviderArchitecturalRole,
  lookupRuntimeNodeKind,
  macLocalAgentExecutionDecision,
  providerIsExecutionAuthority,
} from "./runtime-node-and-optional-provider";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
let passed = 0;
let failed = 0;
const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};
function check(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

check("1. Railway is OPTIONAL_PROVIDER", () => {
  const r = lookupProviderArchitecturalRole("railway");
  assert(r.known && r.role === "OPTIONAL_PROVIDER", String(r));
});
check("2. Vercel is OPTIONAL_PROVIDER", () => {
  const r = lookupProviderArchitecturalRole("Vercel");
  assert(r.known && r.role === "OPTIONAL_PROVIDER", String(r));
});
check("3. Railway/Vercel are optional compute, not required architecture", () => {
  assert(isOptionalComputeProvider("railway") && isOptionalComputeProvider("vercel"), "not optional");
  assert(!isOptionalComputeProvider("github") && !isOptionalComputeProvider("supabase"), "github/supabase mislabeled optional compute");
});
check("4. no listed provider is execution authority", () => {
  for (const id of ["railway", "vercel", "github", "supabase", "google", "unknown-cloud"]) {
    assert(providerIsExecutionAuthority(id) === false, `${id} became execution authority`);
  }
});
check("5. GitHub is SOURCE_AUTHORITY", () => {
  const r = lookupProviderArchitecturalRole("github");
  assert(r.known && r.role === "SOURCE_AUTHORITY", String(r));
});
check("6. Supabase is DATA_SERVICE", () => {
  const r = lookupProviderArchitecturalRole("supabase");
  assert(r.known && r.role === "DATA_SERVICE", String(r));
});
check("7. unknown provider is UNKNOWN, not Core", () => {
  const r = lookupProviderArchitecturalRole("heroku");
  assert(!r.known && r.role === "UNKNOWN_PROVIDER", String(r));
});
check("8. owner-command is CORE_NODE", () => {
  const n = lookupRuntimeNodeKind("control/owner-command");
  assert(n.known && n.node === "CORE_NODE", String(n));
});
check("9. computer-use-authority leases are CORE_NODE", () => {
  const n = lookupRuntimeNodeKind("control/computer-use-authority/lease.ts");
  assert(n.known && n.node === "CORE_NODE", String(n));
});
check("10. os-ui is MAC_LOCAL_AGENT", () => {
  const n = lookupRuntimeNodeKind("connections/os-ui/adapter-contract.ts");
  assert(n.known && n.node === "MAC_LOCAL_AGENT", String(n));
});
check("11. computer-use-executor is MAC_LOCAL_AGENT", () => {
  const n = lookupRuntimeNodeKind("control/computer-use-executor");
  assert(n.known && n.node === "MAC_LOCAL_AGENT", String(n));
});
check("12. keychain is MAC_LOCAL_AGENT", () => {
  const n = lookupRuntimeNodeKind("credentials/macos-keychain/provider.ts");
  assert(n.known && n.node === "MAC_LOCAL_AGENT", String(n));
});
check("13. runtime-control (launchd) is MAC_LOCAL_AGENT", () => {
  const n = lookupRuntimeNodeKind("control/runtime-control");
  assert(n.known && n.node === "MAC_LOCAL_AGENT", String(n));
});
check("14. unclassified folder is not silently Core", () => {
  const n = lookupRuntimeNodeKind("control/durable-meaning");
  assert(!n.known && n.node === "UNCLASSIFIED", String(n));
});
check("15. later portability steps are declared, not implied complete", () => {
  assert(PORTABILITY_SEQUENCE_AFTER_VOCABULARY.length === 6, "sequence drift");
  assert(PORTABILITY_SEQUENCE_AFTER_VOCABULARY[0] === "LINUX_CORE_FAIL_CLOSED_MACOS_ROUTES", "order drift");
  assert(PORTABILITY_SEQUENCE_AFTER_VOCABULARY[5] === "RAILWAY_OFF_CRITICAL_PATH", "last step drift");
});
check("16. contract id is architecture vocabulary, not a provider registry", () => {
  assert(RUNTIME_NODE_AND_OPTIONAL_PROVIDER_CONTRACT_ID === "dna-os/runtime-node-and-optional-provider", "id changed");
});
check("17. CORE_NODE on linux cannot execute MAC_LOCAL_AGENT", () => {
  const d = macLocalAgentExecutionDecision({ current_node: "CORE_NODE", platform: "linux" });
  assert(d.execute === false, "linux Core executed Mac capability");
  if (d.execute) throw new Error("unreachable");
  assert(d.reason_code === MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE, d.reason_code);
  assert(d.required_node === "MAC_LOCAL_AGENT" && d.current_node === "CORE_NODE" && d.execution_attempted === false, "denial shape");
});
check("18. darwin colocated Core may execute MAC_LOCAL_AGENT", () => {
  assert(macLocalAgentExecutionDecision({ current_node: "CORE_NODE", platform: "darwin" }).execute === true, "darwin Core blocked");
});
check("19. linux MAC_LOCAL_AGENT label still cannot execute", () => {
  const d = macLocalAgentExecutionDecision({ current_node: "MAC_LOCAL_AGENT", platform: "linux" });
  assert(d.execute === false, "linux agent allowed");
  if (d.execute) throw new Error("unreachable");
  assert(d.current_node === "MAC_LOCAL_AGENT", "node class dropped");
});
check("20. provider roles unchanged by Mac-execution helper", () => {
  const railway = lookupProviderArchitecturalRole("railway");
  assert(railway.known && railway.role === "OPTIONAL_PROVIDER", "railway role drifted");
  assert(providerIsExecutionAuthority("railway") === false, "railway became execution authority");
});
check("21. process-environment secret provider is CORE_NODE", () => {
  const n = lookupRuntimeNodeKind("credentials/process-environment/provider.ts");
  assert(n.known && n.node === "CORE_NODE", String(n));
});
check("22. secret-resolver is CORE_NODE", () => {
  const n = lookupRuntimeNodeKind("credentials/secret-resolver/node-credential-resolver.ts");
  assert(n.known && n.node === "CORE_NODE", String(n));
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
