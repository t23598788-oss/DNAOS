/**
 * Deterministic proofs for AI_QUEEN_DNA_OS_CAPABILITY_CONSUMER_V1
 * and RAILWAY_MCP_BEHIND_DNA_OS_V1.
 *
 * How to run:
 *   npx tsx control/owner-client-runtime/tests/ai-queen-capability-consumer.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DNA_OS_MCP_TOOLS } from "../../../connections/dna-os-mcp/contract";
import { canDiscover, canInvoke } from "../../../connections/dna-os-mcp/export-policy";
import { discoverRailwayMcpProvider, railwayMcpBehindDnaOs } from "../../../connections/railway/mcp-provider";
import { denyDirectGithubWrite } from "../../mcp-code-knowledge/contract";
import {
  AI_QUEEN_CLIENT,
  AI_QUEEN_CLIENT_ID,
  AI_QUEEN_DEFAULT_TOOLS,
  AI_QUEEN_DNA_OS_CAPABILITY_CONSUMER,
  AI_QUEEN_WORK_ASSISTANT,
  EXTERNAL_PARITY_CLIENT_ID,
  OWNER_AI_QUEEN_PROFILE,
  RAW_RAILWAY_MCP_TOOLS,
  aiQueenAttemptDirect,
  aiQueenGrantSelfScope,
  answerOwnerWorkQuestion,
  externalParityCaller,
  getAiQueenCapabilityProfile,
  getAiQueenStatus,
  ownerAiQueenProfile,
  queenCaller,
  registerAiQueenClient,
  registerExternalParityClient,
  toolsVisibleToAiQueen,
} from "../contract";

declare const process: { cwd(): string; env: Record<string, string | undefined>; exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function catalogNames(): readonly string[] {
  return DNA_OS_MCP_TOOLS.map((tool) => tool.metadata.name);
}

function discoverableCatalog(caller: ReturnType<typeof queenCaller>): readonly string[] {
  return catalogNames().filter((name) => canDiscover(name, caller).allowed);
}

async function main(): Promise<void> {
  await check("A. Circular dependency: Queen does not import MCP tool registry", () => {
    const root = process.cwd();
    const queen = readFileSync(join(root, "control/owner-client-runtime/ai-queen.ts"), "utf8");
    const grants = readFileSync(join(root, "control/owner-client-runtime/ai-queen-grants.ts"), "utf8");
    const policy = readFileSync(join(root, "connections/dna-os-mcp/export-policy.ts"), "utf8");
    const provider = readFileSync(join(root, "connections/railway/mcp-provider.ts"), "utf8");
    assert(!queen.includes("dna-os-mcp/tool-registry"), "queen must not import tool-registry");
    assert(!queen.includes("dna-os-mcp/contract"), "queen must not import MCP contract (avoids hidden cycle)");
    assert(!grants.includes("dna-os-mcp/"), "grants must stay a leaf");
    assert(policy.includes("owner-client-runtime/ai-queen-grants"), "policy uses grants leaf");
    assert(!policy.includes("owner-client-runtime/ai-queen\""), "policy must not import queen module");
    assert(!policy.includes("owner-client-runtime/ai-queen.ts"), "policy must not import queen module");
    assert(!policy.includes("owner-client-runtime/contract"), "policy must not import owner-client-runtime contract");
    assert(!provider.includes("dna-os-mcp/tool-registry"), "railway provider must not import tool-registry");
    assert(!provider.includes("owner-client-runtime/"), "railway provider must not import Queen");
  });

  await check("B. AI Queen MCP access uses existing MCP catalog", () => {
    const names = catalogNames();
    for (const tool of [
      "dna_os.get_ai_queen_status",
      "dna_os.get_ai_queen_capability_profile",
      "dna_os.get_railway_provider_interface_status",
      "dna_os.get_railway_mcp_status",
    ]) {
      assert(names.includes(tool), `missing ${tool}`);
    }
    const client = registerAiQueenClient();
    assert(client.schema === AI_QUEEN_CLIENT, client.schema);
    assert(client.client_id === AI_QUEEN_CLIENT_ID, client.client_id);
    const status = getAiQueenStatus();
    assert(status.schema === AI_QUEEN_DNA_OS_CAPABILITY_CONSUMER, String(status.schema));
    assert(status.AI_QUEEN_USES_EXISTING_MCP === true, "existing MCP");
    assert(status.LOCAL_RUNTIME_GRANTS_AUTHORITY === false, "local runtime");
    assert(status.AI_QUEEN_SPECIAL_ROOT_AUTHORITY === false, "no special root");
    const health = canInvoke("dna_os.get_system_health", queenCaller());
    assert(health.allowed === true, health.reason);
  });

  await check("C. Tool filtering: Queen sees only granted tools", () => {
    const visible = toolsVisibleToAiQueen("OPERATIONAL");
    const listed = discoverableCatalog(queenCaller("OPERATIONAL"));
    assert(visible.every((name) => (AI_QUEEN_DEFAULT_TOOLS as readonly string[]).includes(name)), "visible ⊆ grants");
    assert(listed.every((name) => (AI_QUEEN_DEFAULT_TOOLS as readonly string[]).includes(name)), "catalog ⊆ grants");
    assert(!visible.includes("submit_command"), "submit_command hidden");
    assert(!visible.includes("dna_os.modify_source"), "mutation hidden");
    for (const raw of RAW_RAILWAY_MCP_TOOLS) {
      assert(!visible.includes(raw), `${raw} must not be visible`);
    }
    const profile = getAiQueenCapabilityProfile();
    assert(profile.schema === OWNER_AI_QUEEN_PROFILE, profile.schema);
    assert(profile.visible_tools.every((name) => visible.includes(name)), "profile tools");
    assert(getAiQueenStatus().AI_QUEEN_SEES_ONLY_GRANTED_TOOLS === true, "flag");
  });

  await check("D. Authority parity with other AI clients", () => {
    registerExternalParityClient();
    const queenTools = discoverableCatalog(queenCaller("OPERATIONAL"));
    const parityTools = discoverableCatalog(externalParityCaller("OPERATIONAL"));
    assert(JSON.stringify(queenTools) === JSON.stringify(parityTools), "operational catalog parity");
    const queenWrite = canInvoke("dna_os.modify_source", queenCaller("OPERATIONAL"));
    const parityWrite = canInvoke("dna_os.modify_source", externalParityCaller("OPERATIONAL"));
    assert(queenWrite.allowed === false && parityWrite.allowed === false, "write parity");
    assert(queenWrite.allowed === parityWrite.allowed, "same deny");
    const self = aiQueenGrantSelfScope();
    assert(self.ok === false && self.reason_code === "SCOPE_SELF_EXPANSION_DENIED", self.reason_code);
    assert(ownerAiQueenProfile().LOCAL_PRIVACY_PREFERENCE_IS_AUTHORITY === false, "privacy is not authority");
  });

  await check("E. Source mutation denial", () => {
    for (const tool of [
      "dna_os.modify_source",
      "dna_os.apply_scoped_source_write",
      "dna_os.commit_source",
      "dna_os.publish_source",
      "write_file",
    ]) {
      const attempt = aiQueenAttemptDirect(tool, "OPERATIONAL");
      assert(attempt.allowed === false, `${tool} allowed`);
      assert(attempt.AI_QUEEN_DIRECT_SOURCE_WRITE === false, `${tool} source write`);
      assert(attempt.AI_QUEEN_DIRECT_CANONICAL_COMMIT === false, `${tool} commit`);
    }
  });

  await check("F. Direct GitHub push denial", () => {
    const github = denyDirectGithubWrite();
    assert(github.AI_DIRECT_GITHUB_WRITE === false, "github write");
    const publish = aiQueenAttemptDirect("dna_os.publish_source");
    assert(publish.allowed === false, "publish");
    assert(publish.AI_QUEEN_DIRECT_GITHUB_PUSH === false, "push flag");
    const invoke = canInvoke("dna_os.publish_source", queenCaller());
    assert(invoke.allowed === false, invoke.reason_code);
  });

  await check("G. Railway direct-access denial", () => {
    for (const tool of RAW_RAILWAY_MCP_TOOLS) {
      const discover = canDiscover(tool, queenCaller());
      const invoke = canInvoke(tool, queenCaller());
      const attempt = aiQueenAttemptDirect(tool);
      assert(discover.allowed === false, `${tool} discover`);
      assert(invoke.allowed === false && invoke.reason_code === "NOT_EXPOSED", `${tool} invoke`);
      assert(attempt.allowed === false, `${tool} attempt`);
      assert(attempt.AI_QUEEN_DIRECT_DEPLOY === false, `${tool} deploy`);
    }
    const registered = canInvoke("dna_os.get_railway_provider_interface_status", queenCaller());
    assert(registered.allowed === true, registered.reason);
  });

  await check("H. Railway provider interface status", () => {
    const behind = railwayMcpBehindDnaOs();
    assert(behind.schema === "RAILWAY_MCP_BEHIND_DNA_OS_V1", behind.schema);
    assert(behind.path === "AI_CLIENT -> DNA_OS_MCP -> POLICY -> RAILWAY_ADAPTER -> RAILWAY_MCP_OR_CLI", behind.path);
    assert(behind.RAILWAY_MCP_DIRECT_AI_PRODUCTION_ACCESS === false, "direct access");
    assert(behind.PROVIDER_DOWN_BLOCKS_DNA_OS === false, "outage isolation");
    const discovery = discoverRailwayMcpProvider();
    assert(discovery.schema === "RAILWAY_MCP_PROVIDER_RESOURCE_V1", discovery.schema);
    assert(discovery.RAILWAY_MCP_IS_PROVIDER_INTERFACE === true, "interface");
    assert(discovery.RAILWAY_MCP_IS_CONTROL_PLANE === false, "not control plane");
    assert(discovery.installed_into_editor === false, "not installed into editor");
  });

  await check("I. Provider outage does not block DNA OS", () => {
    const previous = process.env.RAILWAY_PROVIDER_FIXTURE_UNAVAILABLE;
    process.env.RAILWAY_PROVIDER_FIXTURE_UNAVAILABLE = "1";
    try {
      const down = discoverRailwayMcpProvider({ fixture_unavailable: true });
      assert(down.capability === "UNAVAILABLE", down.capability);
      assert(down.RAILWAY_CLI_PRESENT === false, "cli");
      const behind = railwayMcpBehindDnaOs();
      assert(behind.PROVIDER_DOWN_BLOCKS_DNA_OS === false, "dna os continues");
      assert(behind.discovery.capability === "UNAVAILABLE", "projected unavailable");
      const health = canInvoke("dna_os.get_system_health", queenCaller());
      assert(health.allowed === true, "health remains callable");
    } finally {
      if (previous === undefined) delete process.env.RAILWAY_PROVIDER_FIXTURE_UNAVAILABLE;
      else process.env.RAILWAY_PROVIDER_FIXTURE_UNAVAILABLE = previous;
    }
  });

  await check("J. Secret non-exposure", () => {
    const blob = JSON.stringify({
      status: getAiQueenStatus(),
      profile: getAiQueenCapabilityProfile(),
      behind: railwayMcpBehindDnaOs(),
      discovery: discoverRailwayMcpProvider(),
      work: answerOwnerWorkQuestion("งานอะไรทำอยู่"),
    });
    assert(!/railway[_-]?token\s*[:=]\s*\S+/i.test(blob), "no railway token");
    assert(!/ghp_|sk-|keychain:\/\//i.test(blob), "no secret prefixes");
    assert(!/"RAILWAY_TOKEN":\s*"[^"]+"/i.test(blob), "no token field");
    const discovery = discoverRailwayMcpProvider();
    assert(discovery.RAILWAY_SECRET_VISIBLE_TO_AI_QUEEN === false, "queen secret");
    assert(discovery.RAILWAY_SECRET_IN_MCP_CONTEXT === false, "mcp secret");
    assert(discovery.RAILWAY_SECRET_VISIBLE_TO_CURSOR === false, "cursor secret");
  });

  await check("K. Work assistant reads DNA OS MCP facts, not Cursor rediscovery", () => {
    const answer = answerOwnerWorkQuestion("production พร้อมหรือยัง");
    assert(answer.schema === AI_QUEEN_WORK_ASSISTANT, answer.schema);
    assert(answer.source === "DNA_OS_MCP", answer.source);
    assert(answer.cursor_queried === false, "cursor");
    assert(answer.repo_rediscovery === false, "rediscovery");
    assert(answer.CANONICAL_FACT_FIRST === true, "canonical first");
    assert(EXTERNAL_PARITY_CLIENT_ID === "ai://external-parity", EXTERNAL_PARITY_CLIENT_ID);
  });

  console.log(`NEW_DETERMINISTIC_PROOFS_PASSED = ${failed === 0}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
