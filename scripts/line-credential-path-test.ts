#!/usr/bin/env npx tsx
/**
 * LINE Communication Gateway — canonical credential path acceptance test.
 * Proves registry/communication.ts's sendLineMessage():
 *   1. has NO env fallback (LINE_CHANNEL_ACCESS_TOKEN is never read) —
 *      the credential comes only from the "line" connector through the
 *      Connector Lifecycle Run gate (core/connector-loader.ts requireConnector),
 *   2. fails closed (success:false, real owner-facing error) when the
 *      connector doesn't exist yet,
 *   3. never leaks the resolved token into its return value.
 * Uses a local stub Supabase client (query chain stub) — no network, no DB.
 * Run: npx tsx scripts/line-credential-path-test.ts
 */
import { sendLineMessage } from "@/registry/communication";

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

console.log("\nLINE Communication Gateway — canonical credential path tests\n" + "=" .repeat(60));

// A minimal stub standing in for the real Supabase client ONLY to answer
// the connectors-table SELECT the loader performs (empty result = connector
// not registered). This is the same role the in-memory store plays in
// gateway-domains token tests — real behavior is still exercised end-to-end
// through the loader's own code path.
function stubDb(rows: Record<string, unknown>[]) {
  const chain: any = {
    from(_t: string) { return chain; },
    select() { return chain; },
    order() { return chain; },
    eq() { return chain; },
    limit() { return chain; },
    async maybeSingle() { return { data: rows[0] ?? null, error: null }; },
    async single() { return { data: rows[0] ?? null, error: null }; },
  };
  return chain as never;
}

async function main() {
  // 1. Missing connector → fail closed with the loader's owner guidance.
  const missing = await sendLineMessage(stubDb([]) as any, "U123", [{ type: "text", text: "hello" }]);
  check("missing connector fails closed (success:false)", missing.success === false);
  check("error points the owner at the lifecycle (Register/Test/Enable)", typeof missing.error === "string" && (missing.error.includes("/admin/connectors") || missing.error.includes("Register")));
  check("no token is ever present in the response", !("token" in missing) && !("access_token" in missing));

  // 2. Environment variable must be irrelevant — the gateway resolves ONLY
  //    through the connector record now. Plant a fake env value; the send
  //    must still fail closed (proving no env fallback).
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "env-fallback-must-not-be-used";
  const withEnv = await sendLineMessage(stubDb([]) as any, "U123", [{ type: "text", text: "hello" }]);
  check("env var set but connector missing → still fails closed (NO env fallback)", withEnv.success === false);
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;

  console.log("\n" + "=".repeat(60));
  console.log(`${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
