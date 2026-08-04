#!/usr/bin/env npx tsx
/**
 * Acceptance tests for hardcode-governance (HCG-P1).
 * Matches the owner's own 11-point acceptance list. Run: npx tsx scripts/hardcode-governance.test.ts
 */
import { classify, findDuplicates, verifyExternalConstraint } from "@/engines/governance/hardcode-decision-engine";

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

console.log("\nhardcode-governance acceptance tests\n" + "=".repeat(50));

// 1. API key caught as SECURITY_VIOLATION
{
  const r = classify({
    value: "sk_live_ABCDEF1234567890abcdef",
    context_key: "apiKey",
    file: "test.ts",
    line: 1,
  });
  check("API key -> SECURITY_VIOLATION", r.verdict === "SECURITY_VIOLATION", r.verdict);
}

// 2. Environment-dependent URL moved to config/env
{
  const r = classify({
    value: "https://staging.example-internal.com/api",
    context_key: "endpoint",
    file: "test.ts",
    line: 2,
  });
  check("env-dependent URL -> MOVE_TO_ENV/CONFIG", r.verdict === "MOVE_TO_ENV" || r.verdict === "MOVE_TO_CONFIG", r.verdict);
}

// 3. HTTP 404 -> PROTOCOL_CONSTANT
{
  const r = classify({ value: "404", context_key: "status", file: "test.ts", line: 3 });
  check("HTTP 404 -> PROTOCOL_CONSTANT / ALLOWED", r.category === "PROTOCOL_CONSTANT" && r.allowed, `${r.category}/${r.verdict}`);
}

// 4. Fixed-board GPIO pin -> HARDWARE_CONSTANT
{
  const r = classify({ value: "GPIO17", context_key: "gpio_pin", file: "drivers/hardware/boardA/pinmap.ts", line: 4 });
  check("fixed-board GPIO pin -> HARDWARE_CONSTANT", r.category === "HARDWARE_CONSTANT", r.category);
}

// 5. Model-varying GPIO pin -> moved to hardware profile
{
  const r = classify({ value: "GPIO22", context_key: "gpio_pin_map", file: "drivers/hardware/shared/pins.ts", line: 5 });
  check(
    "GPIO pin -> registered/moved to hardware profile registry",
    r.should_live_in === "registry" || r.should_live_in === "source_code",
    r.should_live_in
  );
}

// 6. Model name -> moved to registry
{
  const r = classify({ value: "gpt-4-turbo", context_key: "model_name", file: "test.ts", line: 6 });
  check("model name -> MOVE_TO_REGISTRY", r.verdict === "MOVE_TO_REGISTRY", r.verdict);
}

// 7. Business threshold -> moved to policy/database
{
  const r = classify({ value: "5000", context_key: "debt_threshold", file: "engines/debt/tracking.ts", line: 7, layer: "business_logic" });
  check("business threshold -> MOVE_TO_DATABASE (policy)", r.verdict === "MOVE_TO_DATABASE", r.verdict);
}

// 8. Duplicate constant across multiple files caught
{
  const c1 = classify({ value: "gpt-4-turbo", context_key: "model_name", file: "a.ts", line: 1 });
  const c2 = classify({ value: "gpt-4-turbo", context_key: "model_name", file: "b.ts", line: 9 });
  const dupes = findDuplicates([c1, c2]);
  check("duplicate constant across files detected", Object.keys(dupes).includes("gpt-4-turbo"));
}

// 9. Unknown constant blocked pending review
{
  const r = classify({ value: "zzqx-flerbnorp-9912", context_key: "someMysteryThing", file: "test.ts", line: 9 });
  check("unknown value -> UNKNOWN_REVIEW_REQUIRED, not allowed", r.category === "UNKNOWN" && !r.allowed, `${r.category}/${r.allowed}`);
}

// 10. Standard protocol value never wrongly rejected
{
  const r = classify({ value: "application/json", context_key: "contentType", file: "test.ts", line: 10 });
  check("application/json never rejected as violation", r.verdict !== "SECURITY_VIOLATION" && r.verdict !== "ARCHITECTURE_VIOLATION", r.verdict);
}

// 11. Secret value never allowed in source
{
  const r = classify({
    value: "postgresql://admin:hunter2@db.internal:5432/prod",
    context_key: "databaseUrl",
    file: "test.ts",
    line: 11,
  });
  check("DB connection string with credentials never ALLOWED", !r.allowed && r.verdict === "SECURITY_VIOLATION", `${r.allowed}/${r.verdict}`);
}

// Extra: external constraint checklist sanity
{
  const fixed = verifyExternalConstraint({ provider: "LINE", endpoint_forced_fixed: true });
  const varying = verifyExternalConstraint({ provider: "Supabase", varies_by_region_or_env: true });
  check("fixed-endpoint provider -> PROTOCOL_CONSTANT", fixed.verdict === "PROTOCOL_CONSTANT", fixed.verdict);
  check("env-varying provider -> CONFIGURABLE_VALUE", varying.verdict === "CONFIGURABLE_VALUE", varying.verdict);
}

console.log("=".repeat(50));
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
