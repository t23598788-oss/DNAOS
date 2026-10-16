/**
 * Phase 4 acceptance — MUTUAL TLS TRUST LAYER.
 *
 * REAL crypto, REAL TLS handshake, REAL openssl CLI (no mock anywhere).
 * Proves:
 *   1. CA + server leaf + client leaf chain (openssl-verified, fail-closed)
 *   2. mTLS daemon: authorized client + bearer → SUCCEEDED (real code.read)
 *   3. NO client cert → TLS-layer rejection (never reaches HTTP)
 *   4. foreign-CA client → TLS-layer rejection
 *   5. CA-certed client NOT on the fingerprint allowlist → 401 (revoked)
 *   6. rotation: new leaf + allowlist swap → old 401, new SUCCEEDED
 *   7. relay TLS posture fail-closed (https w/o trio; http with trio refused)
 *   8. relay e2e over real mTLS === Phase 2's invariants
 *
 * Run — from the REPO ROOT (tsx reads the root tsconfig whose paths map
 * '@/…', so no extra hook is needed; computing-package tsconfig has no
 * paths entry, which is why running from dna-os-compute/ would fail on
 * the Business-side relay import):
 *   npx tsx --test dna-os-compute/test/trust-mtls.test.ts
 *
 * Fallback (cwd-independent, in-repo @/ alias hook — plain JS, no deps):
 *   cd dna-os-compute && npx tsx --test --import ./test/alias-resolver.mjs test/trust-mtls.test.ts
 * (see test/alias-resolver.mjs header for its known limits under tsx.)
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import https from "node:https";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureCa, issueLeaf, ensureServerLeaf, rotateClientLeaf, certFingerprint } from "../src/trust.js";
import { RemoteComputeDaemon } from "../src/daemon.js";

// compute-package tests reached the Business-side relay lib via relative
// import (the package's own tsconfig includes tests; the relay lives in
// ../../app — an intra-repo path, decided ONCE, no package dependency).
import {
  resolveRelayConfig, forwardToComputeDaemon, type RelayConfigResult,
} from "../../app/api/admin/devices/_lib/computeRelay.js";
import { buildHttpsFetch } from "../../app/api/admin/devices/_lib/computeRelayRuntime.js";

let failures = 0;
const check = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve().then(fn).then(() => console.log(`PASS ${name}`))
    .catch((e: unknown) => { failures += 1; console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`); });

function openssl(args: string[]): string {
  return execFileSync("openssl", args, { encoding: "utf-8" });
}

const wsRoot = mkdtempSync(path.join(os.tmpdir(), "dna-mtls-ws-"));
writeFileSync(path.join(wsRoot, "answer.ts"), "export const answer = 42;\n", "utf-8");

const daemonPost = (port: number, kind: string, payload: object, authHeaders: { caPem: string; certPem: string; keyPem: string }, commandId: string, workspaceRoot: string | null) =>
  buildHttpsFetch(authHeaders)(`https://127.0.0.1:${port}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer tls-tk" },
    body: JSON.stringify({ commandId, kind, payload, workspaceRoot }),
    timeoutMs: 10_000,
  });

(async () => {
  const trustDir = mkdtempSync(path.join(os.tmpdir(), "dna-mtls-trust-"));
  let caBundle: Awaited<ReturnType<typeof ensureCa>>["bundle"];
  let serverLeaf: Awaited<ReturnType<typeof ensureServerLeaf>>;
  let clientCert1: Awaited<ReturnType<typeof issueLeaf>> | null = null;
  let daemonPort = 0;
  let running: { close: () => void; restartWith: (fprs: Set<string>) => Promise<void> } | null = null;

  async function startDaemon(fprs: Set<string>): Promise<void> {
    const daemon = new RemoteComputeDaemon({
      token: "tls-tk", inferEndpoint: null, bindHost: "127.0.0.1", port: 0, deviceId: null,
      tls: { caCertPath: caBundle.caCertPemPath, serverCertPath: serverLeaf.certPemPath, serverKeyPath: serverLeaf.keyPemPath },
      allowedClientFprs: fprs,
    });
    const server = await daemon.start();
    daemonPort = (server.address() as { port: number }).port;
    running = {
      close: () => server.close(),
      restartWith: (next) => { server.close(); return startDaemon(next); },
    };
  }

  try {
    await check("1. CA + server leaf + client leaf chain verifies via openssl", async () => {
      const r = await ensureCa(trustDir);
      assert.equal(r.created, true);
      caBundle = r.bundle;
      const subject = openssl(["x509", "-in", caBundle.caCertPemPath, "-noout", "-subject"]);
      assert.match(subject, /DNA OS Compute Root CA/);
      serverLeaf = await ensureServerLeaf(caBundle, [], []);
      assert.ok(existsSync(serverLeaf.certPemPath));
      const chainOk = openssl(["verify", "-CAfile", caBundle.caCertPemPath, serverLeaf.certPemPath]).trim();
      assert.match(chainOk, /: OK$/, chainOk);
      clientCert1 = await issueLeaf(caBundle, { cn: "dnaos-macbook", role: "client" });
      const clientOk = openssl(["verify", "-CAfile", caBundle.caCertPemPath, clientCert1!.certPemPath]).trim();
      assert.match(clientOk, /: OK$/, clientOk);
      // fingerprint from trust.ts === openssl's own printed fingerprint
      const opensslFpr = certFingerprintOpenSSL(clientCert1.certPemPath);
      assert.equal(await certFingerprint(clientCert1.certPemPath), opensslFpr);
    });

    await check("2. mTLS daemon: authorized client + bearer → SUCCEEDED (real code.read)", async () => {
      const fpr = clientCert1!.fpr;
      await startDaemon(new Set([fpr]));
      const res = await daemonPost(daemonPort, "code.read", { path: "answer.ts" }, { caPem: readFileSync(caBundle.caCertPemPath, "utf-8"), certPem: readFileSync(clientCert1!.certPemPath, "utf-8"), keyPem: readFileSync(clientCert1!.keyPemPath, "utf-8") }, "mtls-1", wsRoot);
      assert.equal(res.ok, true, res.body);
      const parsed = JSON.parse(res.body) as { result: { status: string; output?: string } };
      assert.equal(parsed.result.status, "SUCCEEDED");
      assert.ok((parsed.result.output ?? "").includes("export const answer = 42;"));
    });

    await check("3. NO client cert → TLS-layer rejection (never HTTP)", async () => {
      const code = await tlsRejectError(() => new https.Agent({ ca: readFileSync(caBundle.caCertPemPath, "utf-8"), rejectUnauthorized: true }), daemonPort);
      assert.ok(code === "ECONNRESET" || code === "ERR_SSL_HTTP_REQUEST" || (code ?? "").startsWith("ERR_SSL"), `expected TLS-layer rejection, got ${code}`);
    });

    await check("4. foreign-CA signed client → TLS-layer rejection", async () => {
      const foreignDir = mkdtempSync(path.join(os.tmpdir(), "dna-mtls-foreign-"));
      const foreign = await ensureCa(foreignDir);
      const intruder = await issueLeaf(foreign.bundle, { cn: "intruder", role: "client" });
      const code = await tlsRejectError(() => new https.Agent({ ca: readFileSync(caBundle.caCertPemPath, "utf-8"), cert: readFileSync(intruder.certPemPath, "utf-8"), key: readFileSync(intruder.keyPemPath, "utf-8"), rejectUnauthorized: true }), daemonPort);
      assert.ok(code === "ECONNRESET" || (code ?? "").startsWith("ERR_SSL"), `expected TLS rejection for foreign CA, got ${code}`);
      rmSync(foreignDir, { recursive: true, force: true });
    });

    await check("5. CA-certed but NOT on allowlist → 401 honest denial string", async () => {
      const stranger = await issueLeaf(caBundle, { cn: "stranger", role: "client" });
      const res = await daemonPost(daemonPort, "code.read", { path: "answer.ts" }, { caPem: readFileSync(caBundle.caCertPemPath, "utf-8"), certPem: readFileSync(stranger.certPemPath, "utf-8"), keyPem: readFileSync(stranger.keyPemPath, "utf-8") }, "mtls-2", wsRoot);
      const parsed = JSON.parse(res.body) as { error?: string };
      assert.match(parsed.error ?? "", /fingerprint not on the authorized allowlist/);
    });

    await check("6. rotation: new leaf + swap allowlist → old 401 ✓, new SUCCEEDED ✓", async () => {
      const rotated = await rotateClientLeaf(caBundle, "dnaos-macbook");
      const newFpr = await certFingerprint(rotated.certPemPath);
      assert.notEqual(newFpr, clientCert1!.fpr, "rotated cert must carry a NEW fingerprint");
      await running!.restartWith(new Set([newFpr]));
      const oldRes = await daemonPost(daemonPort, "code.read", { path: "answer.ts" }, { caPem: readFileSync(caBundle.caCertPemPath, "utf-8"), certPem: readFileSync(clientCert1!.certPemPath, "utf-8"), keyPem: readFileSync(clientCert1!.keyPemPath, "utf-8") }, "old", wsRoot);
      assert.match((JSON.parse(oldRes.body) as { error?: string }).error ?? "", /fingerprint not on the authorized allowlist/);
      const newRes = await daemonPost(daemonPort, "code.read", { path: "answer.ts" }, { caPem: readFileSync(caBundle.caCertPemPath, "utf-8"), certPem: readFileSync(rotated.certPemPath, "utf-8"), keyPem: readFileSync(rotated.keyPemPath, "utf-8") }, "new", wsRoot);
      assert.equal((JSON.parse(newRes.body) as { result?: { status?: string } }).result?.status, "SUCCEEDED");
    });

    await check("7. relay TLS posture fail-closed (https w/o trio, http with trio)", () => {
      const missing = resolveRelayConfig((k: string) =>
        k === "DNA_COMPUTE_DAEMON_URL" ? "https://127.0.0.1:9" :
        k === "DNA_COMPUTE_TOKEN" ? "t" : undefined);
      assert.equal(missing.ok, false);
      if (!missing.ok) assert.match(missing.error, /mTLS trio/);
      const mixed = resolveRelayConfig((k: string) =>
        k === "DNA_COMPUTE_DAEMON_URL" ? "http://127.0.0.1:9" :
        k === "DNA_COMPUTE_TOKEN" ? "t" :
        k === "DNA_COMPUTE_TLS_CA_FILE" ? path.join(os.tmpdir(), "x.pem") : undefined);
      assert.equal(mixed.ok, false);
      if (!mixed.ok) assert.match(mixed.error, /mixed posture refused/);
    });

    await check("8. relay e2e over REAL mTLS (forwardToComputeDaemon with tls config)", async () => {
      const rotated = await rotateClientLeaf(caBundle, "dnaos-macbook");
      // allowlist must include THIS fresh leaf BEFORE rebuilding the URL
      const fpr = await certFingerprint(rotated.certPemPath);
      await running!.restartWith(new Set([fpr]));
      // rebuild URL from daemonPort AFTER the restart captured the new port
      const tlsCfg: RelayConfigResult & { ok: true } = { ok: true, config: { url: `https://127.0.0.1:${daemonPort}`, token: "tls-tk" }, tls: { caPem: readFileSync(caBundle.caCertPemPath, "utf-8"), certPem: readFileSync(rotated.certPemPath, "utf-8"), keyPem: readFileSync(rotated.keyPemPath, "utf-8") } };
      // quick liveness probe on the CURRENT port before the relay call
      const probe = await tlsRejectError(() => new https.Agent({ ca: readFileSync(caBundle.caCertPemPath, "utf-8"), cert: readFileSync(rotated.certPemPath, "utf-8"), key: readFileSync(rotated.keyPemPath, "utf-8"), rejectUnauthorized: true }), daemonPort);
      assert.equal(probe, "TLS_OK", `daemon not alive after restart at :${daemonPort} (probe=${probe})`);
      const res = await forwardToComputeDaemon(
        { toolId: "compute.code.read", payload: { path: "answer.ts" }, commandId: "mtls-3", workspaceRoot: wsRoot },
        tlsCfg,
      );
      assert.ok(res.ok === true, JSON.stringify("res" in res ? res : res));
      if (res.ok) {
        assert.equal(res.status, "SUCCEEDED");
        assert.ok(String((res.result as { output?: string }).output).includes("export const answer = 42;"));
      }
    });
  } finally {
    (running as { close: () => void } | null)?.close();
    rmSync(trustDir, { recursive: true, force: true });
  }

  if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exitCode = 1; }
  else console.log("\nALL CHECKS PASSED");
})();

/** Use openssl's printed fingerprint as the canonical SHA-256(DER) value. */
function certFingerprintOpenSSL(certPemPath: string): string {
  const out = openssl(["x509", "-in", certPemPath, "-noout", "-fingerprint", "-sha256"]);
  return /sha256 Fingerprint=([0-9A-F:]+)/i.exec(out)?.[1]?.replace(/:/g, "").toLowerCase() ?? "";
}



/** Determine the TLS-layer error code when a handshake/cert check is refused. */
async function tlsRejectError(makeAgent: () => https.Agent, port: number): Promise<string | null> {
  return await new Promise((resolve) => {
    const agent = makeAgent();
    const req = https.request({ hostname: "127.0.0.1", port, path: "/health", agent, method: "GET" }, () => {
      resolve("TLS_OK"); // got 200 — unexpected on should-reject paths
    });
    req.on("error", (err: NodeJS.ErrnoException) => resolve(String(err.code)));
    req.end();
    setTimeout(() => resolve(null), 6000);
  });
}
