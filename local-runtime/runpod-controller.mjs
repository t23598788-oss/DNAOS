// RunPod Cloud GPU Controller (owner, 2026-08-04): "สร้างระบบดีเอ็นเอให้
// ตอบสนองกันกับเซิร์ฟเวอร์หลัก...โดยที่เฮียไม่ต้องกดเข้าไปดู" — the plumbing
// half of the Smart Dynamic Trigger the owner described earlier this same
// session (spin the Cloud GPU up only when there's real work, sleep it
// automatically otherwise, instead of paying for 24/7 uptime). This file is
// the one place DNA OS talks to RunPod directly — ensurePodRunning()/
// stopPod()/getPodStatus() — so nothing else in the codebase needs its own
// copy of GPU-fallback logic or RunPod's REST API shape.
//
// Same manual .env.local read pattern as ai-task-watcher.mjs (no dotenv
// dependency in this project). Needs RUNPOD_API_KEY set there — real key
// obtained 2026-08-04 (rpa_... prefix, via console.runpod.io/user/settings
// "API keys"; a distinct AWS_ACCESS_KEY_ID-shaped "S3 API key" and a
// user_-prefixed passkey ID were both mistaken for this at first — neither
// authenticates against the real API). Verified live: GET /v2/pods and
// creating a CPU pod both succeeded with this key — the account itself is
// NOT blocked. Every GPU pod create attempt (7 tries, 5 GPU types, both
// cloud types, 3 datacenters) failed with "no longer any instances
// available" while the CPU test succeeded instantly, pointing at a
// GPU-specific account tier/approval gate on RunPod's side rather than
// real stock exhaustion or a broken key — see chat 2026-08-04.
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const PROJECT_DIR = "/Users/tam/Desktop/DNA OS-โฟลเดอร์หลักต้นฉบับ /dna-os-deadboard";
const POD_NAME = "dna-os-ollama";
// Real Ollama image (owner, 2026-08-04: "เดินสายไฟเชื่อมใช้งานจริงเลย") —
// switched from the bare PyTorch image (which needed a manual SSH install
// step) to the official ollama/ollama image, whose ENTRYPOINT already runs
// `ollama serve` on 11434 with no args needed.
//
// Real bug found live: an earlier version tried to override the container
// start command (`args: 'sh -c "ollama serve & ollama pull ..."'`) to also
// pull models on boot. That failed for real — RunPod's `args` is appended
// to the image's fixed ENTRYPOINT (`ollama`), not a shell replacing it, so
// the container actually ran `ollama sh -c "..."` and errored with
// "unknown command 'sh' for 'ollama'" (confirmed via stream-pod-logs).
// Fixed by not fighting the entrypoint at all — models are installed
// AFTER boot via Ollama's own real HTTP API (POST /api/pull, /api/create),
// which is what ensureModelsInstalled() below does.
const IMAGE = "ollama/ollama:latest";
const CONTAINER_DISK_GB = 30;
const PORTS = ["11434/http", "22/tcp"];
const REQUIRED_MODELS = ["qwen2.5vl:7b", "qwen3:8b"]; // thawatchai is built from qwen3:8b via /api/create, not pulled

// Ordered cheapest-first, real prices/VRAM confirmed live via list-gpu-types
// 2026-08-04 — every model this project runs (qwen2.5vl:7b, thawatchai,
// qwen3:8b) fits comfortably in 24GB, so the fallback chain only exists to
// route around RunPod's own real-time stock churn, not a capability need.
const GPU_FALLBACK_CHAIN = [
  "NVIDIA GeForce RTX 3090",
  "NVIDIA GeForce RTX 4090",
  "NVIDIA RTX A6000",
  "NVIDIA A40",
  "NVIDIA GeForce RTX 5090",
];

function loadEnv() {
  return Object.fromEntries(
    readFileSync(join(PROJECT_DIR, ".env.local"), "utf8")
      .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }),
  );
}

async function runpodRequest(apiKey, path, options = {}) {
  const res = await fetch(`https://api.runpod.io/v2${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`RunPod API ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function listPods(apiKey) {
  const data = await runpodRequest(apiKey, "/pods");
  // Real bug found live 2026-08-04: assumed {items: [...]} (the shape most
  // other RunPod list endpoints use); GET /v2/pods actually returns
  // {pods: [...]} — caught by directly curling the endpoint with the real
  // key rather than trusting the assumption.
  return (data.pods ?? []).filter((p) => p.name === POD_NAME);
}

// Real gap found live 2026-08-04: RunPod's own "availability" summary per
// GPU type does not reliably predict whether create-pod will actually
// succeed at that instant (spot capacity race, not a stale-cache issue —
// confirmed by 5 different GPU types all failing back-to-back). Trying each
// GPU in the fallback chain for real, not just trusting the catalog's
// advertised availability field, is the only honest way to find real stock.
//
// Real request shape verified live against GET https://api.runpod.io/v2/
// openapi.json 2026-08-04 (the MCP tool's own parameter names — imageName/
// gpuTypeIds/cloudType/containerDiskInGb — are its own abstraction, not the
// real wire format): POST /v2/pods wants {name, image, disk, ports,
// gpu:{id,count}, cloud}. A first attempt using the MCP-shaped names got a
// real 422 "missing property 'image'" — caught and fixed against the real
// schema, not guessed a second time.
async function tryCreatePod(apiKey, gpuTypeId) {
  return runpodRequest(apiKey, "/pods", {
    method: "POST",
    body: JSON.stringify({
      name: POD_NAME,
      image: IMAGE,
      disk: CONTAINER_DISK_GB,
      ports: PORTS,
      gpu: { id: gpuTypeId, count: 1 },
      cloud: "COMMUNITY",
    }),
  });
}

// RunPod's real proxy URL pattern for an http-type port — confirmed live
// 2026-08-04 against the actual dna-os-ollama pod (podId-11434.proxy.
// runpod.net answered real requests), not guessed from docs.
export function ollamaUrlForPod(podId) {
  return `https://${podId}-11434.proxy.runpod.net`;
}

// Real readiness gap found live 2026-08-04: a pod moving to status RUNNING
// only means the container started — Ollama's own server takes real boot
// time on top of that. Polling the real /api/tags endpoint until it
// answers (regardless of which models exist yet) is the only honest
// "server is up" signal; trusting RUNNING alone would send the first real
// request into a connection-refused error.
export async function waitForOllamaServerUp(podId, timeoutMs = 120000) {
  const url = ollamaUrlForPod(podId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return { up: true, url };
    } catch { /* not up yet — real network refusal during boot, expected */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { up: false, url, error: `Ollama server ไม่ตอบสนองภายใน ${Math.round(timeoutMs / 1000)} วินาที` };
}

// Real model install, via Ollama's own documented HTTP API — not a shell
// hack fighting the container entrypoint (see the comment on IMAGE above
// for why the first attempt at this failed). `stream:false` on both
// endpoints blocks until the real pull/build finishes instead of requiring
// NDJSON stream parsing, at the cost of a long-held request while a
// multi-GB model downloads — acceptable here since this only runs once
// per freshly-created pod (a stopped→started pod keeps its container disk,
// so re-installing is skipped once /api/tags already lists everything).
async function pullModel(baseUrl, name, timeoutMs) {
  // Real bug found live 2026-08-04: this pod's Ollama version 404s on
  // {"name": ...} — the older /api/pull field name — and only accepts the
  // newer {"model": ...}. Sending both is harmless and covers either
  // Ollama version without needing to detect it first.
  const res = await fetch(`${baseUrl}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name, name, stream: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ollama pull ${name} http ${res.status}: ${await res.text()}`);
}

// Real bug found live 2026-08-04: this pod's Ollama version 400s a raw
// {modelfile: "FROM ...\nSYSTEM ..."} body with "neither 'from' or 'files'
// was specified" — the older /api/create shape (a single Modelfile-text
// field) was replaced by structured fields (from/system/parameters/...).
// Parses local-runtime/Modelfile's own FROM/SYSTEM lines (the only two
// directives it actually uses) into that structured shape instead of
// hand-maintaining the request body separately from the Modelfile file
// itself — one real source, two real consumers (local `ollama create -f`
// and this remote API call).
function parseModelfile(text) {
  const fromMatch = text.match(/^FROM\s+(\S+)/m);
  const systemMatch = text.match(/^SYSTEM\s+"""([\s\S]*?)"""/m);
  if (!fromMatch) throw new Error("Modelfile ไม่มีบรรทัด FROM");
  return { from: fromMatch[1], system: systemMatch ? systemMatch[1].trim() : undefined };
}

async function createThawatchaiModel(baseUrl, timeoutMs) {
  const modelfileText = readFileSync(join(PROJECT_DIR, "local-runtime", "Modelfile"), "utf8");
  const { from, system } = parseModelfile(modelfileText);
  const res = await fetch(`${baseUrl}/api/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "thawatchai", name: "thawatchai", from, system, stream: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ollama create thawatchai http ${res.status}: ${await res.text()}`);
}

export async function ensureModelsInstalled(podId, { pullTimeoutMs = 600000 } = {}) {
  const url = ollamaUrlForPod(podId);
  const tagsRes = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(8000) });
  if (!tagsRes.ok) throw new Error(`ollama /api/tags http ${tagsRes.status}`);
  const existing = new Set(((await tagsRes.json()).models ?? []).map((m) => m.name));

  for (const model of REQUIRED_MODELS) {
    if (existing.has(model) || [...existing].some((m) => m.startsWith(model.split(":")[0]))) continue;
    await pullModel(url, model, pullTimeoutMs);
  }
  if (![...existing].includes("thawatchai:latest") && !existing.has("thawatchai")) {
    await createThawatchaiModel(url, pullTimeoutMs);
  }
  return { ok: true, url };
}

// Combines both real checks — server up, then models present (installing
// any that are missing) — into the one call ai-task-watcher.mjs actually
// needs before it's safe to send a real inference request.
export async function waitForOllamaReady(podId, { serverTimeoutMs = 120000, pullTimeoutMs = 600000 } = {}) {
  const serverUp = await waitForOllamaServerUp(podId, serverTimeoutMs);
  if (!serverUp.up) return { ready: false, url: serverUp.url, error: serverUp.error };
  try {
    await ensureModelsInstalled(podId, { pullTimeoutMs });
  } catch (e) {
    return { ready: false, url: serverUp.url, error: `ติดตั้งโมเดลไม่สำเร็จ: ${e.message}` };
  }
  return { ready: true, url: serverUp.url };
}

export async function ensurePodRunning() {
  const env = loadEnv();
  const apiKey = env.RUNPOD_API_KEY;
  if (!apiKey) throw new Error("RUNPOD_API_KEY ไม่ได้ตั้งค่าใน .env.local");

  // Real PodStatus enum verified against the OpenAPI spec: PROVISIONING/
  // STARTING/RUNNING/EXITED/ERROR/TERMINATED — a single `status` field, not
  // the desiredStatus/status pair an earlier draft assumed.
  const existing = await listPods(apiKey);
  const running = existing.find((p) => p.status === "RUNNING" || p.status === "PROVISIONING" || p.status === "STARTING");
  if (running) return { ok: true, action: "already_running", pod: running, url: ollamaUrlForPod(running.id) };

  const stopped = existing.find((p) => p.status === "EXITED");
  if (stopped) {
    // Real action endpoint verified against the spec: POST /pods/{id}/action
    // with body {action: "start"}, not a /pods/{id}/start path.
    const started = await runpodRequest(apiKey, `/pods/${stopped.id}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "start" }),
    });
    return { ok: true, action: "started_existing", pod: started, url: ollamaUrlForPod(started.id) };
  }

  const errors = [];
  for (const gpuTypeId of GPU_FALLBACK_CHAIN) {
    try {
      const pod = await tryCreatePod(apiKey, gpuTypeId);
      return { ok: true, action: "created", gpuTypeId, pod, url: ollamaUrlForPod(pod.id) };
    } catch (e) {
      errors.push(`${gpuTypeId}: ${e.message}`);
    }
  }
  return { ok: false, action: "no_capacity", errors };
}

export async function stopPod() {
  const env = loadEnv();
  const apiKey = env.RUNPOD_API_KEY;
  if (!apiKey) throw new Error("RUNPOD_API_KEY ไม่ได้ตั้งค่าใน .env.local");

  const existing = await listPods(apiKey);
  if (!existing.length) return { ok: true, action: "no_pod" };
  const results = [];
  for (const pod of existing) {
    const stopped = await runpodRequest(apiKey, `/pods/${pod.id}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "stop" }),
    });
    results.push(stopped);
  }
  return { ok: true, action: "stopped", pods: results };
}

export async function getPodStatus() {
  const env = loadEnv();
  const apiKey = env.RUNPOD_API_KEY;
  if (!apiKey) throw new Error("RUNPOD_API_KEY ไม่ได้ตั้งค่าใน .env.local");
  const existing = await listPods(apiKey);
  return { ok: true, pods: existing };
}

// CLI entry point — `node runpod-controller.mjs ensure|stop|status`.
// This is the manual/testable path; wiring ensurePodRunning()/stopPod()
// into ai-task-watcher.mjs's own poll loop (real Smart Dynamic Trigger:
// wake on a real queued ai_tasks row, sleep after N minutes idle) is the
// next real step once a GPU pod create has been confirmed to succeed at
// least once (currently blocked on a GPU-specific RunPod account gate —
// CPU pod creation already verified working with the real key).
//
// Real bug found live 2026-08-04: `import.meta.url === 'file://' +
// process.argv[1]` silently never matched on this project's real path
// (contains a space and Thai characters — file:// URLs percent-encode
// those, argv[1] doesn't), so the CLI block never ran and the script
// exited 0 with zero output, zero error. fileURLToPath() decodes the URL
// back to a real filesystem path first so the comparison is apples-to-apples.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2];
  const fn = { ensure: ensurePodRunning, stop: stopPod, status: getPodStatus }[cmd];
  if (!fn) {
    console.error("ใช้งาน: node runpod-controller.mjs ensure|stop|status");
    process.exit(1);
  }
  fn().then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(e.message); process.exit(1); });
}
