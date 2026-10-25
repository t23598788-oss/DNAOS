#!/usr/bin/env npx tsx
/**
 * HCG Phase 2.7 (UNKNOWN Noise Reduction) regression tests — one test per
 * new evidence-based category, plus explicit checks that security/business
 * rules were NOT weakened by the new classification steps.
 */
import { classify } from "@/engines/governance/hardcode-decision-engine";

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

console.log("\nHCG Phase 2.7 regression tests\n" + "=".repeat(60));

// MODULE_PATH
{
  const r = classify({ value: "@/engines/tax", context_key: "import", file: "x.ts", line: 1 });
  check("MODULE_PATH: @-aliased import path -> ALLOWED", r.category === "MODULE_PATH" && r.allowed, `${r.category}/${r.verdict}`);
  const r2 = classify({ value: "./bridge-local", context_key: "import", file: "x.ts", line: 1 });
  check("MODULE_PATH: relative import path -> ALLOWED", r2.category === "MODULE_PATH" && r2.allowed, `${r2.category}/${r2.verdict}`);
}

// COMMAND_NAME — real registered command
{
  const r = classify({ value: "hardcode.classify", context_key: "command", file: "x.ts", line: 1 });
  check("COMMAND_NAME: real registered command -> ALLOWED", r.category === "COMMAND_NAME" && r.allowed, `${r.category}/${r.verdict}`);
  // Fabricated lookalike must NOT be waved through — stays UNKNOWN.
  const r2 = classify({ value: "hardcode.frobnicate_nonexistent", context_key: "command", file: "x.ts", line: 1 });
  check("COMMAND_NAME: unregistered lookalike -> stays UNKNOWN, not guessed", r2.category === "UNKNOWN" && !r2.allowed, `${r2.category}/${r2.verdict}`);
}

// EVENT_NAME — real registered event
{
  const r = classify({ value: "hardcode.detected", context_key: "eventType", file: "x.ts", line: 1 });
  check("EVENT_NAME: real registered event -> ALLOWED", r.category === "EVENT_NAME" && r.allowed, `${r.category}/${r.verdict}`);
  const r2 = classify({ value: "hardcode.made_up_event_xyz", context_key: "eventType", file: "x.ts", line: 1 });
  check("EVENT_NAME: unregistered lookalike -> stays UNKNOWN, not guessed", r2.category === "UNKNOWN" && !r2.allowed, `${r2.category}/${r2.verdict}`);
}

// SCHEMA_IDENTIFIER — real column, and ambiguous single-word exclusion
{
  const r = classify({ value: "created_at", context_key: "column", file: "x.ts", line: 1 });
  check("SCHEMA_IDENTIFIER: real migration-derived column -> ALLOWED", r.category === "SCHEMA_IDENTIFIER" && r.allowed, `${r.category}/${r.verdict}`);
  const r2 = classify({ value: "amount", context_key: "field", file: "x.ts", line: 1 });
  check(
    "SCHEMA_IDENTIFIER: ambiguous single word (no underscore) -> stays UNKNOWN, NOT guessed as schema",
    r2.category === "UNKNOWN" && !r2.allowed,
    `${r2.category}/${r2.verdict}`
  );
}

// UI_LITERAL
{
  const r = classify({ value: "ไม่มี ANTHROPIC_API_KEY", context_key: "msg", file: "x.ts", line: 1 });
  check("UI_LITERAL: Thai error message -> ALLOWED", r.category === "UI_LITERAL" && r.allowed, `${r.category}/${r.verdict}`);
  const r2 = classify({ value: "Claude error occurred", context_key: "message", file: "x.ts", line: 1 });
  check("UI_LITERAL: English message with spaces -> ALLOWED", r2.category === "UI_LITERAL" && r2.allowed, `${r2.category}/${r2.verdict}`);
  // Defensive exclusion: security-sensitive context_key must NOT be waved through as UI text.
  const r3 = classify({ value: "my secret password value", context_key: "password", file: "x.ts", line: 1 });
  check(
    "UI_LITERAL: security-keyword context_key excluded, NOT auto-approved as UI text",
    r3.category !== "UI_LITERAL",
    `${r3.category}/${r3.verdict}`
  );
}

// TEST_FIXTURE
{
  const r = classify({ value: "mock-partner-id-123", context_key: "expected", file: "engines/debt/tracking.test.ts", line: 1 });
  check("TEST_FIXTURE: value in a *.test.ts file -> ALLOWED", r.category === "TEST_FIXTURE" && r.allowed, `${r.category}/${r.verdict}`);
  // Forbidden pattern still wins even inside a test file — no amnesty for real-looking secrets.
  const r2 = classify({ value: "sk_live_ABCDEF1234567890abcdef", context_key: "apiKey", file: "engines/debt/tracking.test.ts", line: 1 });
  check(
    "TEST_FIXTURE: real-looking secret inside a test file still SECURITY_VIOLATION",
    r2.verdict === "SECURITY_VIOLATION",
    `${r2.category}/${r2.verdict}`
  );
}

// ── Security/business rules must NOT be weakened by Phase 2.7 ──
console.log("\n-- Security/business regression checks --");
{
  const r = classify({ value: "sk_live_ABCDEF1234567890abcdef", context_key: "apiKey", file: "services/x.ts", line: 1 });
  check("API key still SECURITY_VIOLATION (unaffected)", r.verdict === "SECURITY_VIOLATION");
}
{
  const r = classify({ value: "SuperSecret123!", context_key: "password", file: "services/x.ts", line: 1 });
  check("Password still SECURITY_VIOLATION (unaffected)", r.verdict === "SECURITY_VIOLATION");
}
{
  const r = classify({ value: "5000", context_key: "debt_threshold", file: "engines/debt/x.ts", line: 1, layer: "business_logic" });
  check("Business threshold still MOVE_TO_DATABASE, NOT downgraded to ALLOWED", r.verdict === "MOVE_TO_DATABASE" && !r.allowed, `${r.category}/${r.verdict}`);
}
{
  const r = classify({ value: "1500", context_key: "ราคา", file: "engines/debt/x.ts", line: 1 });
  check("Price (ราคา) still MOVE_TO_CONFIG/MOVE_TO_DATABASE, NOT downgraded to ALLOWED", r.verdict !== "ALLOWED" && !r.allowed, `${r.category}/${r.verdict}`);
}
{
  const r = classify({ value: "claude-haiku-4-5-20251001", context_key: "MODEL", file: "services/x.ts", line: 1 });
  check("Model name (bare MODEL identifier, fixed regex) -> MOVE_TO_REGISTRY, NOT ALLOWED", r.verdict === "MOVE_TO_REGISTRY" && !r.allowed, `${r.category}/${r.verdict}`);
}
{
  const r = classify({ value: "postgresql://admin:hunter2@db.internal:5432/prod", context_key: "databaseUrl", file: "services/x.ts", line: 1 });
  check("DB connection string still SECURITY_VIOLATION (unaffected)", r.verdict === "SECURITY_VIOLATION");
}

console.log("=".repeat(60));
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
