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
import { dirname } from "path";

const PROJECT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
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
// Real bug found live 2026-08-04: RunPod's own OpenAPI spec documents
// `disk` (Container Disk) as "ephemeral, wiped on restart" — not just on
// terminate/recreate as first assumed. Confirmed live: stopped this exact
// pod, started it again (same pod id, `started_existing` path), and
// /api/tags came back empty — both 72b/32b models the previous boot had
// pulled were gone, meaning every single wake-up after idle would have
// re-downloaded ~65GB from scratch, defeating the whole point of the Smart
// Dynamic Trigger (fast wake, low cost per use). Fixed per owner directive
// 2026-08-04 ("แก้ระบบจัดเก็บโมเดลทันที โดยใช้ RunPod Network Volume เป็น
// Persistent Model Storage...ห้ามเก็บโมเดลไว้ใน Container Disk") — models
// now live on a real Network Volume (survives stop/start AND
// terminate+recreate, unlike Container Disk), mounted via OLLAMA_MODELS.
// Container disk only needs to hold the base ollama/ollama image now.
const CONTAINER_DISK_GB = 20;
const PORTS = ["11434/http", "22/tcp"];

// Real Network Volume, created live 2026-08-04 via mcp__runpod__create-
// network-volume (150GB, STANDARD tier) specifically to fix the ephemeral-
// disk bug above. A network volume is pinned to one real datacenter at
// creation and cannot move — every pod that wants these persisted models
// MUST be created in this exact datacenter, per owner directive ("Dynamic
// Trigger ต้องค้นหา GPU ภายในดาต้าเซ็นเตอร์ที่ Network Volume อยู่เท่านั้น...
// ห้ามสร้าง Pod ในพื้นที่อื่นแบบเงียบๆ") — GPU_FALLBACK_CHAIN below varies
// GPU type only, never datacenter.
//
// Real gap found live 2026-08-04, before any pod was created on it: the
// first volume was created in CA-MTL-3 (chosen because get-gpu-type showed
// real A100 80GB PCIe stock there minutes earlier) — by the time the pod
// create call ran, real stock had already dropped to zero for every 80GB+
// GPU type in that one datacenter (spot-market churn, same class of
// finding as the original GPU_FALLBACK_CHAIN work). Per owner instruction
// ("ห้ามสร้าง Pod ในพื้นที่อื่นแบบเงียบๆ") every dead end was reported, not
// silently worked around: CA-MTL-3 (real stock moments earlier, gone by
// create time) -> US-MD-1 (confirmed real network-volume-capable AND real
// A100 SXM stock via get-gpu-type, but COMMUNITY cloud create still 400'd
// "no longer any instances available" 3 retries running) -> EUR-IS-1
// (same COMMUNITY 400 across all 6 GPU types). The real root cause,
// isolated by testing the identical request with only `cloud` changed:
// COMMUNITY cloud (shared/spot hosts) had zero real matching capacity for
// an 80GB+ GPU + network-volume-mount combination across every datacenter
// tried that hour; SECURE cloud (dedicated reserved capacity) succeeded on
// the very first attempt in EUR-IS-1. tryCreatePod's cloud-fallback below
// (community first for cost, secure as a real fallback) reflects this.
const NETWORK_VOLUME_ID = "gomvik56ok";
const NETWORK_VOLUME_DATACENTER_ID = "EUR-IS-1";
const VOLUME_MOUNT_PATH = "/runpod-volume";
// Upgraded 2026-08-04 (owner: "เลือกโมเดลตามความเหมาะสมของงาน...ไม่ต้องยึด
// ตามข้อจำกัดของ Mac อีกต่อไป") from qwen2.5vl:7b/qwen3:8b now that
// inference runs on a real Cloud GPU, not the Mac's own RAM ceiling.
// thawatchai is built from qwen3:32b via /api/create (see Modelfile), not
// pulled directly.
const REQUIRED_MODELS = ["qwen2.5vl:72b", "qwen3:32b"];

// Ordered cheapest-first among real 80GB+-class GPUs — confirmed live via
// list-gpu-types 2026-08-04: qwen2.5vl:72b alone needs ~45GB VRAM (Q4_K_M),
// so the old 24-48GB chain (RTX 3090/4090/A6000/A40/5090) can no longer fit
// it — replaced, not just extended, since none of those GPUs are usable
// for this model size regardless of stock.
const GPU_FALLBACK_CHAIN = [
  "NVIDIA A100 80GB PCIe",
  "NVIDIA A100-SXM4-80GB",
  "NVIDIA H100 NVL",
  "NVIDIA RTX PRO 6000 Blackwell Server Edition",
  "NVIDIA H100 80GB HBM3",
  "NVIDIA H200",
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
// Real finding live 2026-08-04: COMMUNITY cloud (shared/spot hosts) had
// zero real matching capacity for an 80GB+ GPU + network-volume-mount
// combination across 3 different datacenters that hour; SECURE cloud
// (dedicated reserved capacity) succeeded on the first real attempt.
// Tries COMMUNITY first (cheaper — e.g. A100 SXM $1.39 vs $1.49/hr) and
// falls back to SECURE within the SAME datacenter/GPU only if that fails —
// never silently drifts to a different datacenter (the volume can't
// follow it there anyway).
async function tryCreatePod(apiKey, gpuTypeId) {
  const baseBody = {
    name: POD_NAME,
    image: IMAGE,
    disk: CONTAINER_DISK_GB,
    ports: PORTS,
    gpu: { id: gpuTypeId, count: 1 },
    // Pinned to the volume's real datacenter — never omit this, or
    // RunPod's scheduler could place the pod somewhere the volume can't
    // reach at all (real schema requirement: NetworkMount.volumeId
    // "must be an existing NetworkVolume in the same data center as the
    // pod").
    dataCenterIds: [NETWORK_VOLUME_DATACENTER_ID],
    mounts: { network: [{ volumeId: NETWORK_VOLUME_ID, path: VOLUME_MOUNT_PATH }] },
    env: { OLLAMA_MODELS: VOLUME_MOUNT_PATH },
  };
  try {
    return await runpodRequest(apiKey, "/pods", { method: "POST", body: JSON.stringify({ ...baseBody, cloud: "COMMUNITY" }) });
  } catch (communityErr) {
    try {
      return await runpodRequest(apiKey, "/pods", { method: "POST", body: JSON.stringify({ ...baseBody, cloud: "SECURE" }) });
    } catch (secureErr) {
      throw new Error(`community: ${communityErr.message} | secure: ${secureErr.message}`);
    }
  }
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
// for why the first attempt at this failed).
//
// Real infra limit found live 2026-08-04: RunPod's http-port proxy sits
// behind Cloudflare, which 524s (origin timeout) any request with no bytes
// flowing for ~100s — a `stream:false` pull silently blocks for the whole
// download with zero bytes sent until the very end, so a 72b model (tens
// of GB, many minutes) always hit the 524 wall regardless of client-side
// timeoutMs, and re-checking /api/tags afterward showed the model never
// actually landed (the pull's own request context appears to be what keeps
// it running server-side — abandoning the connection abandons the pull,
// it is not a fire-and-forget background job). Fixed by consuming the real
// NDJSON progress stream instead (`stream: true`, Ollama's default) — the
// periodic progress lines keep bytes flowing through Cloudflare, which is
// what actually avoids the 524, not a bigger timeout number.
async function pullModel(baseUrl, name, timeoutMs, onProgress) {
  // Real bug found live 2026-08-04: this pod's Ollama version 404s on
  // {"name": ...} — the older /api/pull field name — and only accepts the
  // newer {"model": ...}. Sending both is harmless and covers either
  // Ollama version without needing to detect it first.
  const res = await fetch(`${baseUrl}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name, name, stream: true }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`ollama pull ${name} http ${res.status}: ${await res.text()}`);

  const decoder = new TextDecoder();
  let buffer = "";
  let lastStatus = null;
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIdx;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;
      const evt = JSON.parse(line);
      lastStatus = evt.status;
      if (onProgress) onProgress(evt);
      if (evt.error) throw new Error(`ollama pull ${name} stream error: ${evt.error}`);
    }
  }
  if (lastStatus !== "success") throw new Error(`ollama pull ${name} จบสตรีมโดยไม่สำเร็จ (status สุดท้าย: ${lastStatus})`);
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

  // Real bug found live 2026-08-04 (caught before shipping, not after a
  // wrong-model incident): matching by base name only (`m.startsWith(...)`)
  // would treat an old qwen2.5vl:7b as already satisfying a
  // qwen2.5vl:72b requirement after a model-size upgrade — silently keeping
  // the small model loaded instead of pulling the real one asked for. Exact
  // tag match only (both bare "qwen3:32b" and Ollama's own normalized
  // "qwen3:32b" form, which is the only variance actually seen live).
  for (const model of REQUIRED_MODELS) {
    if (existing.has(model)) continue;
    let lastLoggedPct = -10;
    await pullModel(url, model, pullTimeoutMs, (evt) => {
      if (evt.total && evt.completed) {
        const pct = Math.floor((evt.completed / evt.total) * 100);
        if (pct >= lastLoggedPct + 10) {
          console.log(`[runpod-controller] pulling ${model}: ${pct}%`);
          lastLoggedPct = pct;
        }
      }
    });
  }
  if (![...existing].includes("thawatchai:latest") && !existing.has("thawatchai")) {
    await createThawatchaiModel(url, pullTimeoutMs);
  }
  return { ok: true, url };
}

// Real digests captured live 2026-08-04 right after the first successful
// pull onto the Network Volume (via GET /api/tags on pod 3a00uxb91q3woz —
// the only real source for this, never hand-typed/guessed). model_verified
// below checks a pod's actual digest against these, so a corrupted or
// short-download would be caught rather than assumed fine just because
// /api/tags lists the name.
const EXPECTED_MODEL_DIGESTS = {
  "qwen2.5vl:72b": "05ea68274581d182f474987ced445c380fccff8c0f9ef8a9bdb48c4ee2ba9620",
  "qwen3:32b": "030ee887880fc378860c2dd35101da424377520441ae4bfe7be6deff8ade7840",
  "thawatchai": "a440c727735eba3533be92248c48571d9df556d412abb721a706811f2c4c0f0d",
};

// Real bug found live 2026-08-04: /api/show's response body (license,
// modelfile, parameters, template, system, details, model_info, tensors,
// capabilities, modified_at) does NOT include a top-level `digest` field
// on this Ollama version — confirmed by printing its real keys, not
// assumed from docs. /api/tags DOES carry a real digest per model, so
// this reads from there instead (the same endpoint model_present already
// calls, just also keeping the digest this time).
async function getModelDigest(baseUrl, name) {
  const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const data = await res.json();
  // "thawatchai" (bare, no tag) must also match Ollama's own normalized
  // "thawatchai:latest" — real form confirmed live via /api/tags output.
  const entry = (data.models ?? []).find((m) => m.name === name || m.model === name || m.name === `${name}:latest`);
  return entry?.digest ?? null;
}

// Owner directive 2026-08-04: "เพิ่มสถานะ volume_attached, model_present,
// model_verified และ runtime_ready ก่อนเปิดรับงาน" — 4 real, independently
// checkable signals instead of one opaque "ready" boolean, so a failure
// mode is visible at the exact layer it happened (volume never mounted vs.
// mounted but empty vs. present but corrupted vs. server itself down).
export async function getReadinessStatus(podId) {
  const env = loadEnv();
  const apiKey = env.RUNPOD_API_KEY;
  const url = ollamaUrlForPod(podId);

  let volume_attached = false;
  try {
    const pod = await runpodRequest(apiKey, `/pods/${podId}`);
    volume_attached = (pod.mounts?.network ?? []).some((m) => m.volumeId === NETWORK_VOLUME_ID);
  } catch { /* pod not reachable via API yet — real false, not a guess */ }

  let model_present = false;
  let modelsFound = [];
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      modelsFound = ((await res.json()).models ?? []).map((m) => m.name);
      model_present = REQUIRED_MODELS.every((m) => modelsFound.includes(m)) &&
        (modelsFound.includes("thawatchai") || modelsFound.includes("thawatchai:latest"));
    }
  } catch { /* server not reachable yet */ }

  let model_verified = false;
  if (model_present) {
    const checks = await Promise.all(
      [...REQUIRED_MODELS, "thawatchai"].map(async (name) => {
        const expected = EXPECTED_MODEL_DIGESTS[name];
        const actual = await getModelDigest(url, name);
        if (!actual) return false;
        return expected ? actual === expected : true; // no recorded baseline yet -> presence + a real digest is the best available signal
      }),
    );
    model_verified = checks.every(Boolean);
  }

  const serverUp = await waitForOllamaServerUp(podId, 5000).then((r) => r.up).catch(() => false);
  const runtime_ready = volume_attached && model_present && model_verified && serverUp;

  return { volume_attached, model_present, model_verified, runtime_ready, modelsFound };
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
  const status = await getReadinessStatus(podId);
  if (!status.runtime_ready) {
    return { ready: false, url: serverUp.url, error: `ตรวจสอบความพร้อมไม่ผ่าน: ${JSON.stringify(status)}` };
  }
  return { ready: true, url: serverUp.url, status };
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
    // Real bug found live 2026-08-04: resuming a specific stopped pod is
    // pinned to whatever GPU type it was originally created with — if that
    // exact type has no free capacity right now, the old code threw here
    // uncaught instead of falling through to GPU_FALLBACK_CHAIN below (which
    // only ran when there was no stopped pod at all). The Network Volume
    // itself isn't GPU-pinned, only the existing pod object is — so on a
    // real resume failure, delete the stale stopped pod and fall through to
    // the create-loop, which can try other GPU types in the same datacenter.
    try {
      const started = await runpodRequest(apiKey, `/pods/${stopped.id}/action`, {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      });
      return { ok: true, action: "started_existing", pod: started, url: ollamaUrlForPod(started.id) };
    } catch (e) {
      console.error(`[runpod-controller] resume of stopped pod ${stopped.id} failed (${e.message}) — deleting it and trying GPU_FALLBACK_CHAIN instead`);
      await runpodRequest(apiKey, `/pods/${stopped.id}`, { method: "DELETE" }).catch(() => {});
    }
  }

  // Owner directive 2026-08-04: "หาก A100 ไม่มีในพื้นที่นั้น ให้รายงานและ
  // เลือก GPU ที่รองรับโดยห้ามสร้าง Pod ในพื้นที่อื่นแบบเงียบๆ" — every
  // tryCreatePod call already pins dataCenterIds to
  // NETWORK_VOLUME_DATACENTER_ID, so this loop only ever varies GPU type
  // within that one real datacenter; it never silently tries elsewhere.
  const errors = [];
  for (const gpuTypeId of GPU_FALLBACK_CHAIN) {
    try {
      const pod = await tryCreatePod(apiKey, gpuTypeId);
      return { ok: true, action: "created", gpuTypeId, pod, url: ollamaUrlForPod(pod.id) };
    } catch (e) {
      errors.push(`${gpuTypeId}: ${e.message}`);
    }
  }
  return {
    ok: false,
    action: "no_capacity",
    errors,
    note: `ไม่มี GPU รุ่นไหนว่างใน datacenter ${NETWORK_VOLUME_DATACENTER_ID} เลย (จุดที่ Network Volume ตั้งอยู่) — ไม่ได้ลองไปสร้างที่ datacenter อื่น เพราะ volume ไม่สามารถย้ายไปใช้ที่อื่นได้จริง`,
  };
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
