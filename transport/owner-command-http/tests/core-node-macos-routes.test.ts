/**
 * Step 3: CORE_NODE on non-darwin fail-closes Mac-only HTTP/execution paths
 * before os-ui, Keychain, or Apple Events. Does not start a second command authority.
 *
 * Does not import transport/owner-command-http/server.ts (that graph loads
 * write-gate + runtime-adapter). Wiring of those routes is asserted from source.
 *
 *   npx tsx transport/owner-command-http/tests/core-node-macos-routes.test.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE,
  lookupRuntimeNodeKind,
  setRuntimeNodePlatformForTests,
} from "../../../contracts/architecture/runtime-node-and-optional-provider";
import { executeComputerUse } from "../../../control/computer-use-executor/executor";
import type { ExecutorDeps } from "../../../control/computer-use-executor/executor";
import { handleComputerUseApi } from "../computer-use-api";
import { handleOwnerCredentialRoute } from "../owner-credential-routes";
import { handleGoogleOauthRoute } from "../google-oauth-routes";
import { GOOGLE_CONNECTION_ID, GOOGLE_OAUTH_BEGIN_PATH } from "../../../connections/google-workspace/contract";
import { coreNodeUnavailableForCapability, classifyOwnerAuthMethod, OWNER_AUTH_METHOD_CLASSIFICATION } from "../mac-local-agent-gate";
import { verifySharedSecret } from "../../../permissions/network-auth-gate/contract";
import { classifyCommand } from "../../../control/command-router/contract";
import { coreNodeLiveServiceProbeKind, httpProbeDeclaredService } from "../../../software/system-graph/contract";
import { isVoiceBridgeEnabled, setVoiceBridgeEnabled } from "../../../control/agent-gateway/voice-bridge";
import { handleGoogleWorkspaceReadCommand } from "../../../connections/google-workspace/google-workspace-adapter";
import { createServer } from "node:http";
import type { GoogleLifecycleDeps } from "../../../connections/google-workspace/oauth/lifecycle";

declare const process: { env: Record<string, string | undefined>; exitCode?: number; cwd(): string };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const ROOT = process.cwd();

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function check(name: string, body: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(body)
    .then(() => {
      passed += 1;
      console.log(`PASS ${name}`);
    })
    .catch((error) => {
      failed += 1;
      console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    });
}

function nonNull<T>(value: T | null | undefined, label: string): T {
  assert(value != null, label);
  return value as T;
}

function denialShape(body: Record<string, unknown>, capability: string): void {
  assert(body.ok === false, "ok should be false");
  assert(body.reason_code === MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE, String(body.reason_code));
  assert(body.required_node === "MAC_LOCAL_AGENT", String(body.required_node));
  assert(body.current_node === "CORE_NODE", String(body.current_node));
  assert(body.execution_attempted === false, "execution_attempted");
  assert(body.capability === capability, String(body.capability));
}

function readRel(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

async function run(): Promise<void> {
  console.log("=== core-node-macos-routes.test.ts ===");
  setRuntimeNodePlatformForTests("linux");

  try {
    await check("1. CORE_NODE /command portable work-order path is not Mac-gated", () => {
      const kind = lookupRuntimeNodeKind("control/owner-command");
      assert(kind.known && kind.node === "CORE_NODE", String(kind));
      const src = readRel("transport/owner-command-http/server.ts");
      const handleStart = src.indexOf("export async function handleCommand");
      assert(handleStart >= 0, "handleCommand missing");
      const handleEnd = src.indexOf("\nexport ", handleStart + 40);
      const handle = src.slice(handleStart, handleEnd > handleStart ? handleEnd : handleStart + 12000);
      const uiGate = handle.indexOf('coreNodeUnavailableForCapability("connections/os-ui")');
      const uiIf = handle.indexOf("if (uiWorkOrder)");
      const workOrder = handle.indexOf("if (workOrder)");
      assert(uiIf >= 0 && uiGate > uiIf, "uiWorkOrder gate missing");
      assert(workOrder > uiGate, "workOrder branch lost");
      assert(handle.indexOf("coreNodeUnavailableForCapability", workOrder) === -1, "portable workOrder was Mac-gated");
      assert(coreNodeUnavailableForCapability("connections/os-ui") !== null, "linux should deny os-ui");
    });

    await check("2+3. CORE_NODE screenshot/read_screen denied before os-ui", async () => {
      for (const capability of ["connections/os-ui"] as const) {
        const body = coreNodeUnavailableForCapability(capability);
        assert(body !== null, "linux os-ui should deny");
        denialShape(body as unknown as Record<string, unknown>, capability);
      }
      let ran = false;
      const deps: ExecutorDeps = {
        validateAuthority: () => ({ ok: true, lease: {} as never }),
        runUiWorkOrder: (async () => {
          ran = true;
          return { ok: true, status: "COMPLETED", summary: "", evidence: [], artifacts: [], next_action: null, idempotent_replay: false, presentation: null, focus_restored: null };
        }) as never,
        now: () => new Date("2026-09-11T00:00:00.000Z"),
        newEvidenceId: () => "cue-linux-shot",
        evidenceDir: "/tmp/cue-core-node-test",
        platform: "linux",
      };
      for (const operation of ["screenshot", "read_screen"] as const) {
        const { outcome, evidence } = await executeComputerUse(
          { work_order_id: `wo-${operation}`, authority_id: "auth", requester: "agent:test", operation, target: "screen", ui: {} },
          deps,
        );
        assert(outcome === null && ran === false && evidence.executed === false, `${operation} adapter ran`);
        assert(evidence.result_status === MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE, String(evidence.result_status));
      }
    });

    await check("4. CORE_NODE Keychain credential write denied after session, before Keychain", async () => {
      const empty = await handleOwnerCredentialRoute("POST", "/owner/credential", new URLSearchParams(), {
        credential_ref: "credential://anthropic/owner/agent-runtime",
        owner_session_id: "",
        secret: "x",
      });
      const emptyReply = nonNull(empty, "empty cred reply");
      assert(emptyReply.status === 401, "empty session must 401");
      assert((emptyReply.body as { error?: string }).error !== MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE, "skipped session auth");

      let keychainCalls = 0;
      const denied = await handleOwnerCredentialRoute(
        "POST",
        "/owner/credential",
        new URLSearchParams(),
        {
          credential_ref: "credential://anthropic/owner/agent-runtime",
          owner_session_id: "session-ok",
          secret: "would-never-be-stored",
        },
        {
          validateOwnerSession: () => ({ ok: true, session: { session_id: "session-ok" } } as never),
          registerOwnerApiCredential: (async () => {
            keychainCalls += 1;
            return { credential_ref: "credential://anthropic/owner/agent-runtime" };
          }) as never,
        },
      );
      const deniedReply = nonNull(denied, "denied cred reply");
      assert(deniedReply.status === 503, `expected 503, got ${deniedReply.status}`);
      denialShape(deniedReply.body as Record<string, unknown>, "credentials/macos-keychain");
      assert(keychainCalls === 0, "Keychain register was called");
    });

    await check("5. CORE_NODE Mac browser/AppleEvent verify denied", async () => {
      const api = handleComputerUseApi("POST", "/computer-use/owner/verify", { purpose: "test" });
      const apiReply = nonNull(api, "verify api");
      assert(apiReply.status === 503, "api path");
      denialShape(apiReply.body as Record<string, unknown>, "control/owner-authentication");
      const apple = readRel("control/agent-gateway/agent-authority-router.ts");
      const gate = apple.indexOf("macLocalAgentExecutionDecision");
      const dyn = apple.indexOf('import("../../connections/os-ui/adapter-contract")');
      assert(gate >= 0 && dyn > gate, "Apple Event import is not after the Core gate");
    });

    await check("6. executor denial is before runUiWorkOrder", async () => {
      let ran = false;
      const deps: ExecutorDeps = {
        validateAuthority: () => ({ ok: true, lease: {} as never }),
        runUiWorkOrder: (async () => {
          ran = true;
          return { ok: true, status: "COMPLETED", summary: "", evidence: [], artifacts: [], next_action: null, idempotent_replay: false, presentation: null, focus_restored: null };
        }) as never,
        now: () => new Date("2026-09-11T00:00:00.000Z"),
        newEvidenceId: () => "cue-linux-1",
        evidenceDir: "/tmp/cue-core-node-test",
        platform: "linux",
      };
      const { outcome, evidence } = await executeComputerUse(
        { work_order_id: "wo-linux", authority_id: "auth", requester: "agent:test", operation: "screenshot", target: "screen", ui: {} },
        deps,
      );
      assert(outcome === null && ran === false && evidence.executed === false, "adapter ran");
      assert(evidence.result_status === MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE, String(evidence.result_status));
      const browser = await executeComputerUse(
        { work_order_id: "wo-eval", authority_id: "auth", requester: "agent:test", operation: "browser_eval", target: "https://example.invalid", ui: { script: "1" } },
        deps,
      );
      assert(browser.outcome === null && ran === false && browser.evidence.executed === false, "browser_eval adapter ran");
    });

    await check("7. denial reports MAC_LOCAL_AGENT requirement", () => {
      const body = coreNodeUnavailableForCapability("connections/os-ui");
      assert(body !== null && body.required_node === "MAC_LOCAL_AGENT", String(body?.required_node));
      const monitor = readRel("transport/owner-command-http/monitor-activity-projection.ts");
      const lsofCall = monitor.indexOf("listeningProcess");
      const gate = monitor.indexOf("macLocalAgentExecutionDecision");
      assert(gate >= 0 && lsofCall > 0 && monitor.indexOf("if (!node.execute)") > gate, "process-table gate missing");
    });

    await check("8. MAC_LOCAL_AGENT/darwin behavior is not 503 from this gate", () => {
      setRuntimeNodePlatformForTests("darwin");
      assert(coreNodeUnavailableForCapability("connections/os-ui") === null, "darwin os-ui gated");
      assert(coreNodeUnavailableForCapability("control/owner-authentication") === null, "darwin verify gated");
      assert(coreNodeUnavailableForCapability("credentials/macos-keychain") === null, "darwin keychain gated");
      setRuntimeNodePlatformForTests("linux");
      assert(coreNodeUnavailableForCapability("connections/os-ui") !== null, "linux os-ui not gated");
    });

    await check("9. no second command authority — lease grant still Core", () => {
      const grant = handleComputerUseApi("POST", "/computer-use/authority/grant", {
        owner_session_id: "missing",
        requester: "agent:test",
        executor: "control/computer-use-executor",
        capability: "connections/os-ui",
        target: "screen",
        operations: ["screenshot"],
        ttl_seconds: 60,
      });
      const grantReply = nonNull(grant, "grant reply");
      assert(grantReply.status === 200, "grant path missing");
      const body = grantReply.body as { reason_code?: string; error?: string };
      assert(typeof body.reason_code === "string", JSON.stringify(body));
      assert(body.reason_code !== MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE, "grant became Mac-only");
      const leaseKind = lookupRuntimeNodeKind("control/computer-use-authority/lease.ts");
      assert(leaseKind.known && leaseKind.node === "CORE_NODE", String(leaseKind));
    });

    await check("10. shared-secret still applies before Mac denial", () => {
      const serverSrc = readRel("transport/owner-command-http/server.ts");
      const auth = serverSrc.indexOf("if (req.method !== \"GET\" && req.method !== \"HEAD\" && !requireSharedSecret(req, res))");
      const command = serverSrc.indexOf('if (req.method === "POST" && req.url === "/command")');
      const computerUse = serverSrc.indexOf('if (req.url?.startsWith("/computer-use/")');
      assert(auth >= 0 && command > auth && computerUse > auth, "shared-secret is not before write routes");
      assert(verifySharedSecret(undefined, "secret") === false, "empty header accepted");
      assert(verifySharedSecret("Bearer secret", "secret") === true, "matching bearer rejected");
    });

    await check("router os-ui step blocked on linux before adapter", () => {
      const router = readRel("control/command-router/router.ts");
      const runOsUi = router.indexOf("async function runOsUiStep");
      const gate = router.indexOf("macLocalAgentExecutionDecision", runOsUi);
      const adapter = router.indexOf("runUiWorkOrder", gate);
      assert(runOsUi >= 0 && gate > runOsUi && adapter > gate, "runOsUiStep does not gate before runUiWorkOrder");
      assert(router.includes("macLocalAgentBlockedStep(\"connections/os-ui\")"), "os-ui blocked step missing");
    });

    await check("production Google OAuth begin (no injected deps) is Keychain-gated", async () => {
      const reply = await handleGoogleOauthRoute("POST", GOOGLE_OAUTH_BEGIN_PATH, new URLSearchParams(), {
        redirect_uri: "https://example.invalid/callback",
      });
      const beginReply = nonNull(reply, "oauth begin reply");
      assert(beginReply.status === 503, `status ${beginReply.status}`);
      denialShape(beginReply.body, "credentials/macos-keychain");
    });

    await check("Google OAuth status does not invoke Keychain on CORE_NODE", async () => {
      let keychainCalls = 0;
      const deps = {
        findRecord: () => ({
          connection_id: GOOGLE_CONNECTION_ID,
          provider: "google_workspace",
          google_account_id: null,
          account_email: null,
          state: "NOT_CONNECTED",
          credential_ref: null,
          granted_scope: null,
          code_verifier: null,
          state_nonce: null,
          redirect_uri: null,
          authorize_expires_at: null,
          failure_reason: null,
          expected_account_email: null,
          prior_google_account_id: null,
          prior_account_email: null,
          prior_credential_ref: null,
          prior_granted_scope: null,
          created_at: "2026-09-11T00:00:00.000Z",
          updated_at: "2026-09-11T00:00:00.000Z",
        }),
        registerOwnerApiCredential: (async () => {
          keychainCalls += 1;
          throw new Error("keychain must not run");
        }) as never,
      } as unknown as GoogleLifecycleDeps;
      const reply = await handleGoogleOauthRoute("GET", "/oauth/google/workspace/status", new URLSearchParams(), {}, deps);
      const statusReply = nonNull(reply, "oauth status reply");
      assert(statusReply.status === 200, `status ${statusReply.status}`);
      assert((statusReply.body as { ok?: boolean }).ok === true, JSON.stringify(statusReply.body));
      assert(keychainCalls === 0, "Keychain register was invoked");
      const src = readRel("transport/owner-command-http/google-oauth-routes.ts");
      const statusIdx = src.indexOf('path === "/oauth/google/workspace/status"');
      assert(statusIdx >= 0 && src.indexOf("findGoogleAuthorizationRecord", statusIdx) > statusIdx, "production status must use store findRecord");
      assert(!src.slice(statusIdx, statusIdx + 800).includes("getAuthorizationStatus(GOOGLE_CONNECTION_ID)"), "production status used default lifecycle deps");
    });

    await check("every owner-auth method has explicit classification and Mac methods deny before native verifier", () => {
      const methods = Object.keys(OWNER_AUTH_METHOD_CLASSIFICATION);
      assert(methods.length === 3, `expected 3 methods, got ${methods.length}`);
      for (const method of ["macos-console-session", "touch-id", "human-verification"]) {
        assert(classifyOwnerAuthMethod(method) === "MAC_LOCAL_AGENT_ONLY", method);
        const api = handleComputerUseApi("POST", "/computer-use/owner/authenticate", {
          expected_owner: "tam",
          method,
          ttl_seconds: 60,
        });
        const apiReply = nonNull(api, `${method} authenticate`);
        assert(apiReply.status === 503, `${method} status ${apiReply.status}`);
        denialShape(apiReply.body as Record<string, unknown>, "control/owner-authentication");
      }
      assert(classifyOwnerAuthMethod("password") === "UNKNOWN", "password");
      const unknown = handleComputerUseApi("POST", "/computer-use/owner/authenticate", {
        expected_owner: "tam",
        method: "password",
        ttl_seconds: 60,
      });
      const unknownReply = nonNull(unknown, "unknown method authenticate");
      assert(unknownReply.status === 503, "unknown method not fail-closed");
      const authSrc = readRel("control/owner-authentication/authenticate.ts");
      const apiSrc = readRel("transport/owner-command-http/computer-use-api.ts");
      const gate = apiSrc.indexOf("coreNodeUnavailableForOwnerAuthMethod");
      const call = apiSrc.indexOf("authenticateOwner", gate);
      assert(gate >= 0 && call > gate, "authenticateOwner ran before Core gate");
      assert(authSrc.includes("/usr/bin/stat"), "console-user probe missing from authenticate.ts (classification still Mac-only)");
    });

    await check("graph probe skips Mac host probes and still runs portable HTTP", async () => {
      assert(coreNodeLiveServiceProbeKind() === "http_only", coreNodeLiveServiceProbeKind());
      const graphSrc = readRel("software/system-graph/projection.ts");
      const httpOnly = graphSrc.indexOf('probeKind === "http_only"');
      const runOp = graphSrc.indexOf("runOperation(serviceId", httpOnly);
      assert(httpOnly >= 0 && runOp > httpOnly, "runOperation not after http_only branch");
      await new Promise<void>((resolve, reject) => {
        const srv = createServer((_req, res) => {
          res.writeHead(200);
          res.end("ok");
        });
        srv.listen(0, "127.0.0.1", () => {
          const addr = srv.address();
          if (!addr || typeof addr === "string") {
            srv.close();
            reject(new Error("bind failed"));
            return;
          }
          void httpProbeDeclaredService(addr.port, "/", 1000).then((probe) => {
            srv.close();
            try {
              assert(probe.healthy === true, JSON.stringify(probe));
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        });
      });
      setRuntimeNodePlatformForTests("darwin");
      assert(coreNodeLiveServiceProbeKind() === "launchd_lsof_and_http", "darwin probe kind");
      setRuntimeNodePlatformForTests("linux");
    });

    await check("voice-bridge is portable Core state, not Mac TTS execution", () => {
      assert(isVoiceBridgeEnabled() === false, "sweep switch must stay off");
      const before = isVoiceBridgeEnabled();
      setVoiceBridgeEnabled(true, "identity-core-node-test");
      assert(isVoiceBridgeEnabled() === false && before === false, "enable re-armed TTS");
      const voice = readRel("control/agent-gateway/voice-bridge.ts");
      assert(voice.includes("voice announcement permanently disabled"), "speak removal missing");
      assert(!/await runUiWorkOrder\(/.test(voice), "sweep still calls os-ui");
      const router = readRel("control/command-router/router.ts");
      assert(router.includes("runVoiceBridgeStep"), "voice step missing");
      assert(!router.includes("macLocalAgentBlockedStep(\"voice-bridge\")"), "portable voice was Mac-gated");
    });

    await check("free-text command may classify portably; os-ui stays BLOCKED before adapter", () => {
      const portable = classifyCommand("research results");
      assert(portable.status === "MATCHED", JSON.stringify(portable));
      if (portable.status === "MATCHED") assert(portable.capability.capability_id === "research-engine", portable.capability.capability_id);
      const ui = classifyCommand("เปิด vscode");
      assert(ui.status === "MATCHED", JSON.stringify(ui));
      if (ui.status === "MATCHED") assert(ui.capability.capability_id === "os-ui", ui.capability.capability_id);
      const cmd = readRel("transport/owner-command-http/server.ts");
      const handleStart = cmd.indexOf("export async function handleCommand");
      const handleEnd = cmd.indexOf("\nexport ", handleStart + 40);
      const handle = cmd.slice(handleStart, handleEnd > handleStart ? handleEnd : handleStart + 12000);
      const workOrder = handle.indexOf("if (workOrder)");
      const freeText = handle.indexOf("respondWithChatIntake");
      assert(workOrder >= 0 && freeText > workOrder, "free-text /command path missing");
    });

    await check("production Google Workspace adapter does not construct Keychain resolver on CORE_NODE", async () => {
      const denied = await handleGoogleWorkspaceReadCommand(
        { command_id: "cmd-gw", issued_by: { identity_id: "i", acting_as_account_id: "a", acting_as_tenant_id: "t", software_id: "s", kind: "human" }, intent: "google.gmail.messages.list", payload: {}, issued_at: new Date().toISOString() },
      );
      assert(denied.ok === false, "production google ran");
      if (denied.ok) throw new Error("unreachable");
      assert(denied.rejection.outcome === "AUTH_REQUIRED", denied.rejection.outcome);
      assert(denied.rejection.reason.includes(MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE), denied.rejection.reason);
      assert(denied.rejection.denied_at_stage === "authenticate", denied.rejection.denied_at_stage);
      const injected = await handleGoogleWorkspaceReadCommand(
        { command_id: "cmd-gw-2", issued_by: { identity_id: "i", acting_as_account_id: "a", acting_as_tenant_id: "t", software_id: "s", kind: "human" }, intent: "google.gmail.messages.list", payload: {}, issued_at: new Date().toISOString() },
        {
          credentialResolver: {
            resolveAccessToken: async () => {
              return { ok: false, reason: "injected", outcome: "AUTH_REQUIRED" };
            },
          },
        },
      );
      assert(injected.ok === false, "injected path succeeded unexpectedly");
      if (injected.ok) throw new Error("unreachable");
      assert(!injected.rejection.reason.includes(MAC_LOCAL_AGENT_UNAVAILABLE_ON_CORE), "injected hermetic resolver was Core-gated");
    });
  } finally {
    setRuntimeNodePlatformForTests(undefined);
  }

  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
