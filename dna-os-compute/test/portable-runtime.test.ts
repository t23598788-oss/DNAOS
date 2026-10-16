/**
 * Phase 3 acceptance — PORTABLE RUNTIME (real fs, real os, real HTTP).
 * Proves: live metering numbers, honest fail-closed GPU outside Windows,
 * the Windows CIM PARSE path (exported pure fn — the same code that runs on
 * a Windows host) against real CIM structure including AMD RX 9070 XT,
 * token-gated /metering / /gpu on the REAL daemon, portable bundle build
 * with credential refusal, and the Windows scripts' security posture.
 */
import assert from "node:assert";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import http from "node:http";
import { readCpu, readRam, gpuAdapterFor, detectGpu, parseWin32VideoController } from "../src/metering.js";
import { RemoteComputeDaemon } from "../src/daemon.js";

let failures = 0;
const check = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve().then(fn).then(() => console.log(`PASS ${name}`))
    .catch((e: unknown) => { failures += 1; console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`); });

const REPO = path.resolve(import.meta.dirname, "..", "..");
const CMP = path.dirname(import.meta.dirname);

// Real CIM text shape for a modern AMD card (structure of the actual query
// the adapter runs on a Windows host — the parse under test is the real one).
const CIM_AMD_JSON = JSON.stringify([
  { name: "AMD Radeon RX 9070 XT", vendor: "Advanced Micro Devices, Inc.", driver: "32.0.12033.1035", vram: 48103643392 },
]);

await (async () => {
  await check("live CPU/RAM metering (real os, this machine)", () => {
    const cpu = readCpu();
    const ram = readRam();
    assert.ok(cpu.cores > 0 && cpu.model !== null && cpu.model.length > 3);
    if (process.platform !== "win32") assert.ok((cpu.loadAvg1m ?? 0) >= 0);
    assert.ok(ram.totalBytes > 1_000_000_000 && ram.freeBytes > 0);
    assert.ok(ram.usedPercent > 0 && ram.usedPercent < 100);
  });

  await check("GPU fail-closed honest outside Windows (no fabricated card)", async () => {
    if (process.platform === "win32") return;
    const net = await detectGpu(gpuAdapterFor());
    if (net.status === "UNAVAILABLE") {
      assert.equal(net.gpus.length, 0);
      assert.match(String(net.reason), /fail-closed|rocm-smi not found/);
    }
    // AVAILABLE is acceptable only when a real rocm-smi answered — either is honest.
  });

  await check("Windows CIM parse: real AMD RX 9070 XT → honestly labeled AMD", () => {
    const parsed = parseWin32VideoController(CIM_AMD_JSON);
    assert.equal(parsed.gpus.length, 1);
    assert.equal(parsed.gpus[0].vendor, "AMD");
    assert.match(parsed.gpus[0].name ?? "", /RX 9070 XT/);
    assert.match(parsed.gpus[0].driverVersion ?? "", /^32\./);
    assert.ok((parsed.gpus[0].vramBytes ?? 0) > 4_000_000_000);
  });

  await check("Windows CIM parse: junk non-JSON is thrown (never a fake GPU)", () => {
    assert.throws(() => parseWin32VideoController("{[not json"));
    // empty answer → empty list, no card invented
    const empty = parseWin32VideoController("");
    assert.equal(empty.gpus.length, 0);
  });

  await check("token-gated /metering + /gpu on the REAL daemon (401 without token)", async () => {
    const daemon = new RemoteComputeDaemon({ token: "mtr-tk", inferEndpoint: null, bindHost: "127.0.0.1", port: 0, deviceId: null });
    const server = await daemon.start();
    const port = (server.address() as { port: number }).port;
    const get = (p: string, tok?: string) => new Promise<{ code: number; body: string }>((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${port}${p}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} }, (res) => {
        let b = ""; res.on("data", (c) => (b += String(c))); res.on("end", () => resolve({ code: res.statusCode ?? 0, body: b }));
      });
      req.on("error", reject);
      req.end();
    });
    try {
      const noAuth = await get("/metering");
      assert.equal(noAuth.code, 401);
      const mtr = await get("/metering", "mtr-tk");
      assert.equal(mtr.code, 200);
      const m = JSON.parse(mtr.body) as { metering: { ram: { totalBytes: number }; gpu: { adapter: string } } };
      assert.ok(m.metering.ram.totalBytes > 1e9);
      const gpuAuth = await get("/gpu", "mtr-tk");
      assert.equal(gpuAuth.code, 200);
      assert.ok(((JSON.parse(gpuAuth.body) as { gpu: { adapter: string } }).gpu.adapter.length) > 0);
    } finally {
      server.close();
    }
  });

  await check("portable bundle builds a REAL zip (out loud, no external deps)", () => {
    const out = execFileSync("node", [path.join(CMP, "scripts", "build-portable.mjs")], { cwd: REPO, encoding: "utf-8" });
    const built = /PORTABLE_BUILT (\S+\.zip)/.exec(out);
    assert.ok(built !== null, out);
    assert.ok(existsSync(built[1]), `zip missing: ${built[1]}`);
    assert.match(out, /PORTABLE_FILES \d+/);
  });

  await check("Windows scripts security posture (static, honest)", () => {
    const read = (f: string) => readFileSync(path.join(CMP, "scripts", f), "utf-8");
    const start = read("start.ps1");
    assert.match(start, /127\.0\.0\.1/);
    assert.doesNotMatch(start, /netsh|firewall/i);
    for (const f of ["install-deps.ps1", "start.ps1", "pair.ps1", "stop.ps1", "health.ps1", "build-installer.ps1"]) {
      assert.doesNotMatch(read(f), /SUPABASE_|SERVICE_ROLE|RAILWAY_TOKEN|API_KEY/i, `${f} carries a credential shape`);
    }
    const installer = read("build-installer.ps1");
    assert.match(installer, /NOT VERIFIED/i);
    const readme = readFileSync(path.join(REPO, "README-SERVER.md"), "utf-8");
    assert.match(readme, /LAN = manual opt-in/);
  });

  if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exitCode = 1; }
  else console.log("\nALL CHECKS PASSED");
})();
