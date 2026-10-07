/**
 * Owner-verification gate — acceptance test for plan step 2.
 *
 * Proves the decide route can no longer approve on an admin session alone:
 *   1. the client is a bridge only (no crypto, no biometrics, no session store)
 *   2. a valid artifact is verified by the infrastructure transport and the
 *      VERIFIED identity — not the caller's email — is what gets recorded
 *   3. every failure mode is fail-closed with the infrastructure's own wording,
 *      and the route touches nothing before that verdict
 *
 * The "infrastructure transport" here is a real local stub HTTP server standing in
 * for POST /owner/session/from-verification-artifact (loopback only, ephemeral
 * port). No external network, no real owner session, no secret in the repo.
 *
 * Run: npx tsx scripts/owner-verification-decide-test.ts
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OWNER_COMMAND_SECRET_ENV,
  OWNER_VERIFICATION_PATH,
  verifyOwnerArtifact,
} from "@/core/owner-verification-client";

const ROOT = join(__dirname, "..");
const TEST_SECRET = "test-only-shared-secret-0000";

let pass = 0;
let fail = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

function source(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

interface StubState {
  requests: number;
  authorization: string | undefined;
  body: string;
}

/** Stub of the infrastructure transport: same path, same Authorization gate shape. */
function startInfraStub(state: StubState) {
  return createServer((req, res) => {
    state.requests++;
    state.authorization = req.headers.authorization;
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      state.body = raw;
      if (req.method !== "POST" || req.url !== OWNER_VERIFICATION_PATH) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason_code: "NOT_FOUND", detail: "unknown route" }));
        return;
      }
      // Mirrors the infrastructure's own gate outcome for a missing/mismatched secret.
      if (req.headers.authorization !== `Bearer ${TEST_SECRET}`) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      let artifact: { kind?: string } = {};
      try {
        artifact = (JSON.parse(raw) as { artifact?: { kind?: string } }).artifact ?? {};
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, reason_code: "INVALID_JSON_BODY" }));
        return;
      }
      if (artifact.kind === "valid") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            owner_session_id: "owner-session-stub-1",
            owner_identity: "t23598788-oss",
            expires_at: "2026-09-22T12:00:00.000Z",
            authenticated_via: "REMOTE_MAC_LOCALAUTH:BIOMETRIC",
            evidence_reference: "control/owner-authentication/data/remote-verification-artifacts.jsonl",
          })
        );
        return;
      }
      // The real infra's own rejection shape — the caller must repeat it verbatim.
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ ok: false, reason_code: "VERIFICATION_ARTIFACT_SIGNATURE_INVALID", detail: "signature did not match" })
      );
    });
  });
}

/** Stub that answers 200 with non-JSON (a broken/misconfigured transport). */
function startNonJsonStub() {
  return createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("not json at all");
  });
}

async function main() {
  console.log("\nOwner verification gate — acceptance tests\n" + "=".repeat(60));

  const state: StubState = { requests: 0, authorization: undefined, body: "" };
  const stub = startInfraStub(state);
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", () => resolve()));
  const stubPort = (stub.address() as { port: number }).port;
  const origin = `http://127.0.0.1:${stubPort}`;

  console.log("\n1. the client is a bridge, not an auth implementation");
  const clientSrc = source("core/owner-verification-client.ts");
  const importLines = (clientSrc.match(/^\s*import .*$/gm) ?? []).join(" ");
  check(
    "the client imports nothing for crypto, biometrics, sessions or files",
    !/crypto|node:fs|child_process|owner-authentication/i.test(importLines),
    `imports=${importLines.slice(0, 160) || "(none)"}`
  );
  check(
    "no crypto/session/file API is even called here",
    !/createHmac\s*\(|timingSafeEqual\s*\(|validateOwnerSession\s*\(|authenticateOwner\s*\(|readFileSync\s*\(|appendFileSync\s*\(/.test(
      clientSrc
    )
  );
  check(
    "it targets the infrastructure's own route and reuses its secret name",
    clientSrc.includes(OWNER_VERIFICATION_PATH) && clientSrc.includes("OWNER_COMMAND_HTTP_SHARED_SECRET")
  );
  check(
    "the only outbound call is the infrastructure's verification route",
    (clientSrc.match(/fetchImpl\(/g) ?? []).length === 1 && clientSrc.includes(OWNER_VERIFICATION_PATH)
  );

  console.log("\n2. a real artifact is verified by the transport, and only its verdict is used");
  delete process.env[OWNER_COMMAND_SECRET_ENV];
  const notConfigured = await verifyOwnerArtifact({ kind: "valid" }, { origin });
  check(
    "no shared secret configured -> NOT_CONFIGURED, nothing sent",
    notConfigured.ok === false && notConfigured.code === "OWNER_VERIFICATION_NOT_CONFIGURED" && state.requests === 0,
    `code=${notConfigured.ok ? "ok" : notConfigured.code} requests=${state.requests}`
  );

  const unreachable = await verifyOwnerArtifact(
    { kind: "valid" },
    { origin: "http://127.0.0.1:9", secret: TEST_SECRET, timeoutMs: 1500 }
  );
  check(
    "unreachable transport -> UNREACHABLE (no approval possible)",
    unreachable.ok === false && unreachable.code === "OWNER_VERIFICATION_UNREACHABLE",
    `code=${unreachable.ok ? "ok" : unreachable.code}`
  );

  const verified = await verifyOwnerArtifact({ kind: "valid", nonce: "n-1" }, { origin, secret: TEST_SECRET });
  check(
    "valid artifact -> verified identity + session from the infrastructure",
    verified.ok === true &&
      verified.owner_identity === "t23598788-oss" &&
      verified.owner_session_id === "owner-session-stub-1" &&
      verified.verified_by === `infrastructure:${OWNER_VERIFICATION_PATH}`,
    verified.ok ? `identity=${verified.owner_identity}` : `code=${verified.code}`
  );
  check(
    "the request carried the artifact verbatim behind the shared-secret header",
    state.authorization === `Bearer ${TEST_SECRET}` && state.body.includes('"nonce":"n-1"'),
    `authorization=${state.authorization ?? "none"}`
  );

  const rejected = await verifyOwnerArtifact({ kind: "tampered" }, { origin, secret: TEST_SECRET });
  check(
    "a rejected artifact keeps the infrastructure's own reason_code + http status",
    rejected.ok === false && rejected.code === "VERIFICATION_ARTIFACT_SIGNATURE_INVALID" && rejected.http_status === 401,
    rejected.ok ? "ok" : `code=${rejected.code} status=${rejected.http_status}`
  );

  const nonJson = startNonJsonStub();
  await new Promise<void>((resolve) => nonJson.listen(0, "127.0.0.1", () => resolve()));
  const nonJsonPort = (nonJson.address() as { port: number }).port;
  const broken = await verifyOwnerArtifact({ kind: "valid" }, { origin: `http://127.0.0.1:${nonJsonPort}`, secret: TEST_SECRET });
  check(
    "a broken transport reply -> BAD_RESPONSE (never treated as verified)",
    broken.ok === false && broken.code === "OWNER_VERIFICATION_BAD_RESPONSE",
    broken.ok ? "ok" : `code=${broken.code}`
  );
  await new Promise<void>((resolve) => nonJson.close(() => resolve()));
  await new Promise<void>((resolve) => stub.close(() => resolve()));

  console.log("\n3. the decide route cannot approve without that verdict");
  verifyDecideRoute();

  console.log("\n" + "=".repeat(60));
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("[owner-verification-decide-test] failed:", e);
  process.exit(1);
});
/** Section 3 — source-level proof that the decide route's approval path is gated. */
function verifyDecideRoute() {
  const routeSrc = source("app/api/gateway/proposals/[id]/decide/route.ts");
  check(
    "an approval must carry the artifact",
    routeSrc.includes("owner_verification_artifact") && routeSrc.includes("OWNER_VERIFICATION_REQUIRED")
  );
  check("the verdict is requested from the infrastructure bridge", routeSrc.includes("verifyOwnerArtifact(artifact)"));
  check(
    "verification happens before any proposal read or decision write",
    routeSrc.indexOf("verifyOwnerArtifact(artifact)") < routeSrc.indexOf("listPendingProposals(") &&
      routeSrc.indexOf("verifyOwnerArtifact(artifact)") < routeSrc.indexOf('decideProposal(db, id, "approved"')
  );
  check(
    "a failed verdict reports the infrastructure's code and leaves the proposal pending",
    routeSrc.includes("OWNER_VERIFICATION_FAILED") && routeSrc.includes('proposal_status: "pending"')
  );
  check(
    "the recorded decider is the verified identity, not the caller's session email",
    routeSrc.includes("const decidedBy = ownerIdentity") && !/decideProposal\(db, id, "approved", auth\.email/.test(routeSrc)
  );
  check(
    "the verification evidence travels with every approval decision",
    (routeSrc.match(/owner_verification: ownerVerificationEvidence/g) ?? []).length === 3
  );
  check(
    "rejection is not gated (it grants no authority) and stays on the session identity",
    /decideProposal\(db, id, "rejected", auth\.email\)/.test(routeSrc)
  );
  check("the admin session check is still required first", routeSrc.includes("requireAuth(ADMIN_TIER)"));

  const envExample = source(".env.local.example");
  check(
    "both bridge env names are documented for the operator",
    envExample.includes("OWNER_COMMAND_HTTP_SHARED_SECRET") && envExample.includes("INFRA_OWNER_VERIFICATION_URL")
  );
}


