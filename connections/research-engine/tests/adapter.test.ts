/**
 * หน้าที่: the real test for `connections/research-engine/`. Drives
 * `../research-engine-adapter.ts` directly by hand, the same convention as
 * `../../../execution/run/tests/executor.test.ts` and
 * `../../github/adapter.test.ts`.
 *
 * No real network dependency: every scenario below installs a fake global
 * `fetch` for the duration of one check, then restores the real one — no
 * live `http://localhost:8787` is required for this file to pass, and no
 * `node:http` / `@types/node` dependency is introduced (this repo has
 * neither installed — see ../../github/host-runtime.ts's own reasoning).
 * A SEPARATE live smoke check (guarded, only runs when a real server
 * answers) is included at the end and never fails the suite when the
 * server is absent — it reports what it saw, honestly, matching
 * ../../github/adapter.test.ts's "skipped, not faked" discipline.
 *
 * How to run:
 *   npx tsx connections/research-engine/tests/adapter.test.ts
 *
 * Input: none (all fixtures constructed in this file).
 * Output: PASS/FAIL lines and a non-zero exit code on any failure.
 * Dependency ที่อนุญาต: ../research-engine-adapter.ts, ../adapter-contract.ts.
 * สิ่งที่ห้ามแตะ: ห้าม leave the fake `fetch` installed after any check —
 * every scenario restores the real global `fetch` before returning,
 * checked by an assertion in main().
 */

import { fetchResearchEngineLatestResult } from "../research-engine-adapter";
import { RESEARCH_ENGINE_MALFORMED_WARNING, RESEARCH_ENGINE_OFFLINE_WARNING } from "../adapter-contract";

declare const globalThis: Record<string, unknown>;
declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };
declare const setTimeout: (fn: () => void, ms: number) => unknown;
declare const clearTimeout: (handle: unknown) => void;

type FakeResponse = { ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> };
type FakeFetch = (url: string, init: { headers: Record<string, string>; signal: { addEventListener?: (type: string, cb: () => void) => void } }) => Promise<FakeResponse>;

const REAL_FETCH = globalThis["fetch"];

function install(fake: FakeFetch): void {
  globalThis["fetch"] = fake;
}

function restore(): void {
  globalThis["fetch"] = REAL_FETCH;
}

const VALID_LATEST_BODY = {
  status: "ok",
  experiment_id: "exp-test-fixture-0001",
  baseline: { run_id: "exp-test-fixture-0001::baseline", identity: { provider: "MOCK", model_id: "mock-baseline" } },
  candidate: {
    run_id: "exp-test-fixture-0001::candidate",
    identity: { run_id: "exp-test-fixture-0001::candidate", provider: "MLX", model_id: "mlx-community/Test-Model-4bit" },
    metrics: {
      false_allow_rate: 0.02,
      false_deny_rate: 0.01,
      unknown_rate: 0.15,
      malformed_rate: 0.05,
      average_latency_ms: 4200.5,
      p50_latency_ms: 4000.1,
      p95_latency_ms: 6000.2,
      p99_latency_ms: 7000.3,
    },
    formulas: {
      SAFETY_SCORE: { value: -50.0, formula_version: "v1", reason: "computed" },
      EFFICIENCY_SCORE: { value: 0.42, formula_version: "v1", reason: "computed" },
      VALUE_GAIN: { value: "NOT_MEASURED", formula_version: "v1", reason: "not enough samples" },
      RESOURCE_PENALTY: { value: 0.11, formula_version: "v1", reason: "computed" },
      MODEL_UTILITY_SCORE: { value: "NOT_MEASURED", formula_version: "v1", reason: "value_gain not measured" },
    },
    decision: { decision: "INSUFFICIENT_DATA", reason: "not enough samples", gate_passed: true, gate_failures: [], sample_count: 3 },
    lifecycle: { cold_start_latency_ms: 4200.5, warm_latency_ms: 3900.0, model_load_ms_first_case: 1000.0 },
  },
};

function jsonResponse(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function connectedFetch(latestBody: unknown = VALID_LATEST_BODY): FakeFetch {
  return async (url) => {
    if (url.includes("/api/research/health")) return jsonResponse(200, { status: "ok" });
    if (url.includes("/api/research/latest")) return jsonResponse(200, latestBody);
    throw new Error(`unexpected URL in test fake fetch: ${url}`);
  };
}

function offlineFetch(): FakeFetch {
  return async () => {
    throw new Error("simulated ECONNREFUSED");
  };
}

function malformedJsonFetch(): FakeFetch {
  return async (url) => {
    if (url.includes("/api/research/health")) return jsonResponse(200, { status: "ok" });
    return { ok: true, status: 200, json: async () => { throw new Error("Unexpected token in JSON"); }, text: async () => "not json at all" };
  };
}

/**
 * Health succeeds fast; the /latest call is designed to hang forever and
 * only settle via the real `AbortSignal.timeout` firing its "abort" event —
 * proving `hostFetch`'s timeout budget actually fires, not just that a
 * promise eventually settles some other way. A `setTimeout` fallback (a
 * REF'd timer, unlike Node's `AbortSignal.timeout` internal timer, which is
 * observed to be unref'd and so would let the process exit silently before
 * ever firing if nothing else kept the event loop alive) exists only to
 * keep this test process alive long enough to observe the real abort — if
 * the fallback fires INSTEAD of the abort listener, that is treated as a
 * real test failure (the timeout mechanism did not work), never masked.
 */
function hangingLatestFetch(): FakeFetch {
  return (url, init) => {
    if (url.includes("/api/research/health")) return Promise.resolve(jsonResponse(200, { status: "ok" }));
    return new Promise<FakeResponse>((_resolve, reject) => {
      let abortFired = false;
      const signal = init.signal;
      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", () => {
          abortFired = true;
          reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
        });
      }
      setTimeout(() => {
        if (!abortFired) reject(new Error("TEST BUG / REAL DEFECT: the real AbortSignal.timeout abort event never fired within the fallback window"));
      }, 2_000);
    });
  };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function check(name: string, body: () => Promise<void> | void): Promise<void> {
  try {
    await body();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    restore();
  }
}

async function main(): Promise<void> {
  console.log("connections/research-engine/ — capability test\n");

  await check("connected: health ok + well-formed latest -> COMPLETED with every required field preserved", async () => {
    install(connectedFetch());
    const outcome = await fetchResearchEngineLatestResult({ baseUrl: "http://fake-research-engine.test" });
    assert(outcome.status === "COMPLETED", `expected COMPLETED, got ${outcome.status}`);
    assert(outcome.warnings.length === 0, `expected no warnings, got ${JSON.stringify(outcome.warnings)}`);
    const artifact = outcome.artifacts.find((a) => a.kind === "research_run_id");
    assert(artifact !== undefined && artifact.ref === "exp-test-fixture-0001::candidate", "expected a research_run_id artifact matching candidate.run_id");

    const joined = outcome.evidenceEntries.map((e) => e.note).join(" | ");
    for (const requiredSubstring of [
      "experiment_id=exp-test-fixture-0001",
      "run_id=exp-test-fixture-0001::candidate",
      "provider=MLX",
      "model_id=mlx-community/Test-Model-4bit",
      "safety_score=-50",
      "efficiency_score=0.42",
      "value_gain=NOT_MEASURED",
      "resource_penalty=0.11",
      "model_utility_score=NOT_MEASURED",
      "research_decision=INSUFFICIENT_DATA",
      "false_allow=0.02",
      "unknown_rate=0.15",
      "malformed_rate=0.05",
      "average_latency_ms",
      "p50_latency_ms",
      "cold_start_latency_ms",
    ]) {
      assert(joined.includes(requiredSubstring), `expected evidence to preserve "${requiredSubstring}", got: ${joined}`);
    }
  });

  await check("offline: health check transport error -> BLOCKED + RESEARCH_ENGINE_OFFLINE, latest never called", async () => {
    let latestWasCalled = false;
    install(async (url) => {
      if (url.includes("/api/research/latest")) latestWasCalled = true;
      throw new Error("simulated ECONNREFUSED");
    });
    const outcome = await fetchResearchEngineLatestResult({ baseUrl: "http://fake-research-engine.test" });
    assert(outcome.status === "BLOCKED", `expected BLOCKED, got ${outcome.status}`);
    assert(outcome.warnings.includes(RESEARCH_ENGINE_OFFLINE_WARNING), `expected RESEARCH_ENGINE_OFFLINE warning, got ${JSON.stringify(outcome.warnings)}`);
    assert(!latestWasCalled, "expected /api/research/latest to never be called once the health check failed");
  });

  await check("offline: health ok but latest transport error -> BLOCKED + RESEARCH_ENGINE_OFFLINE", async () => {
    install(async (url) => {
      if (url.includes("/api/research/health")) return jsonResponse(200, { status: "ok" });
      throw new Error("simulated connection reset mid-request");
    });
    const outcome = await fetchResearchEngineLatestResult({ baseUrl: "http://fake-research-engine.test" });
    assert(outcome.status === "BLOCKED", `expected BLOCKED, got ${outcome.status}`);
    assert(outcome.warnings.includes(RESEARCH_ENGINE_OFFLINE_WARNING), "expected RESEARCH_ENGINE_OFFLINE warning");
  });

  await check("offline: health endpoint returns non-2xx -> BLOCKED + RESEARCH_ENGINE_OFFLINE", async () => {
    install(async (url) => (url.includes("/api/research/health") ? jsonResponse(503, { status: "error" }) : jsonResponse(200, VALID_LATEST_BODY)));
    const outcome = await fetchResearchEngineLatestResult({ baseUrl: "http://fake-research-engine.test" });
    assert(outcome.status === "BLOCKED", `expected BLOCKED, got ${outcome.status}`);
    assert(outcome.warnings.includes(RESEARCH_ENGINE_OFFLINE_WARNING), "expected RESEARCH_ENGINE_OFFLINE warning");
  });

  await check("malformed: latest response body is not valid JSON -> FAILED + RESEARCH_ENGINE_MALFORMED_RESPONSE, no throw", async () => {
    install(malformedJsonFetch());
    const outcome = await fetchResearchEngineLatestResult({ baseUrl: "http://fake-research-engine.test" });
    assert(outcome.status === "FAILED", `expected FAILED, got ${outcome.status}`);
    assert(outcome.warnings.includes(RESEARCH_ENGINE_MALFORMED_WARNING), `expected RESEARCH_ENGINE_MALFORMED_RESPONSE warning, got ${JSON.stringify(outcome.warnings)}`);
  });

  await check("malformed: latest response is valid JSON but missing required fields -> FAILED, no throw", async () => {
    install(connectedFetch({ status: "ok", experiment_id: "exp-incomplete" })); // no candidate at all
    const outcome = await fetchResearchEngineLatestResult({ baseUrl: "http://fake-research-engine.test" });
    assert(outcome.status === "FAILED", `expected FAILED, got ${outcome.status}`);
    assert(outcome.warnings.includes(RESEARCH_ENGINE_MALFORMED_WARNING), "expected RESEARCH_ENGINE_MALFORMED_RESPONSE warning");
  });

  await check("timeout: latest request exceeds the timeout budget -> BLOCKED, resolves promptly (does not hang)", async () => {
    install(hangingLatestFetch());
    const startedAt = Date.now();
    const outcome = await fetchResearchEngineLatestResult({ baseUrl: "http://fake-research-engine.test", timeoutMilliseconds: 150 });
    const elapsedMs = Date.now() - startedAt;
    assert(outcome.status === "BLOCKED", `expected BLOCKED, got ${outcome.status}`);
    assert(outcome.warnings.includes(RESEARCH_ENGINE_OFFLINE_WARNING), "expected RESEARCH_ENGINE_OFFLINE warning on timeout");
    assert(elapsedMs < 3_000, `expected the call to resolve well under 3000ms once the 150ms timeout budget fired, took ${elapsedMs}ms`);
  });

  assert(globalThis["fetch"] === REAL_FETCH, "the real global fetch must be restored after every check");

  console.log(`\nTOTAL: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
    return;
  }

  // Optional live smoke check — never fails the suite, only reports what was actually observed.
  console.log("\n--- OPTIONAL LIVE SMOKE CHECK against real http://localhost:8787 (not required to pass) ---");
  try {
    const liveOutcome = await fetchResearchEngineLatestResult();
    console.log(`      live result: status=${liveOutcome.status} summary="${liveOutcome.summary}"`);
  } catch (error) {
    console.log(`      live check threw unexpectedly (this itself would be a real defect, since the adapter must never throw): ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

void main();
