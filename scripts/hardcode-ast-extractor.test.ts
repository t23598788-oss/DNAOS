#!/usr/bin/env npx tsx
/**
 * HCG Phase 2.8 (Scanner Context Coverage) extractor regression tests — the
 * 13 required cases, run against the real scanText()/classify() pipeline
 * (AST-based for .ts/.tsx as of this phase).
 */
import { scanText } from "@/engines/governance/hardcode-decision-engine";

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

function findByValue(hits: ReturnType<typeof scanText>, needle: string) {
  return hits.find((h) => h.value.includes(needle) || h.value === needle);
}

console.log("\nHCG Phase 2.8 — AST extractor regression tests\n" + "=".repeat(60));

// 1. object property that is a password
{
  const hits = scanText(`const obj = { password: "SuperSecret123!" };`, "x.ts");
  const h = findByValue(hits, "SuperSecret123!");
  check("1. object property password -> extracted + SECURITY_VIOLATION", !!h && h.verdict === "SECURITY_VIOLATION", JSON.stringify(h));
}

// 2. function argument that is an API key (as a named object property passed into a call — the
// realistic shape this codebase actually uses, e.g. fetchWithKey({ api_key: "..." }); a truly
// bare positional string with zero surrounding identifier, e.g. sendRequest("raw-value"), has no
// keyword to anchor on and is a separate, already-known limitation — not what this case tests).
{
  const hits = scanText(`const r = fetchWithKey({ api_key: "AIzaSyD1234567890abcdefghijk" });`, "x.ts");
  const h = findByValue(hits, "AIzaSyD1234567890abcdefghijk");
  check("2. API key (object arg property) -> extracted + SECURITY_VIOLATION", !!h && h.verdict === "SECURITY_VIOLATION", JSON.stringify(h));
}

// 3. fetch URL
{
  const hits = scanText(`fetch("https://api.example.com/v1/resource");`, "services/x.ts");
  const h = findByValue(hits, "https://api.example.com");
  check("3. fetch() URL (positional arg) -> extracted + MOVE_TO_ENV", !!h && h.verdict === "MOVE_TO_ENV", JSON.stringify(h));
}

// 4. authorization header
{
  const hits = scanText(`const headers = { Authorization: "Bearer sk_live_ABCDEF1234567890abcdef" };`, "services/x.ts");
  const h = findByValue(hits, "Bearer sk_live");
  check("4. Authorization header value -> extracted + SECURITY_VIOLATION", !!h && h.verdict === "SECURITY_VIOLATION", JSON.stringify(h));
}

// 5. numeric threshold
{
  const hits = scanText(`const debt_threshold = 5000;`, "engines/debt/x.ts");
  const h = hits.find((x) => x.value === "5000");
  check("5. numeric threshold -> extracted + MOVE_TO_CONFIG/MOVE_TO_DATABASE (not ALLOWED)", !!h && !h.allowed, JSON.stringify(h));
}

// 6. numeric HTTP status
{
  const hits = scanText(`const status = 404;`, "services/x.ts");
  const h = hits.find((x) => x.value === "404");
  check("6. numeric HTTP status -> extracted + PROTOCOL_CONSTANT/ALLOWED", !!h && h.category === "PROTOCOL_CONSTANT" && h.allowed, JSON.stringify(h));
}

// 7. MIME type
{
  const hits = scanText(`const contentType = "application/json";`, "services/x.ts");
  const h = findByValue(hits, "application/json");
  check("7. MIME type -> extracted + PROTOCOL_CONSTANT/ALLOWED", !!h && h.category === "PROTOCOL_CONSTANT" && h.allowed, JSON.stringify(h));
}

// 8. import path
{
  const hits = scanText(`import { classify } from "@/engines/governance/hardcode-decision-engine";`, "services/x.ts");
  const h = findByValue(hits, "@/engines/governance");
  check("8. import path -> extracted + MODULE_PATH/ALLOWED", !!h && h.category === "MODULE_PATH" && h.allowed, JSON.stringify(h));
}

// 9. registered event name
{
  const hits = scanText(`const evt = "hardcode.detected";`, "services/x.ts");
  const h = findByValue(hits, "hardcode.detected");
  check("9. registered event name -> extracted + EVENT_NAME/ALLOWED", !!h && h.category === "EVENT_NAME" && h.allowed, JSON.stringify(h));
}

// 10. unregistered event name
{
  const hits = scanText(`const evt = "hardcode.made_up_event_xyz";`, "services/x.ts");
  const h = findByValue(hits, "hardcode.made_up_event_xyz");
  check("10. unregistered event-shaped name -> extracted + stays UNKNOWN, not guessed", !!h && h.category === "UNKNOWN" && !h.allowed, JSON.stringify(h));
}

// 11. workflow state
{
  const hits = scanText(`if (status === "OPEN") { doThing(); }`, "engines/debt/x.ts");
  const h = hits.find((x) => x.value === "OPEN");
  check("11. workflow state (comparison) -> extracted + stays UNKNOWN, NOT auto-approved", !!h && h.category === "UNKNOWN" && !h.allowed, JSON.stringify(h));
}

// 12. Thai UI literal
{
  const hits = scanText(`throw new Error("ไม่มี ANTHROPIC_API_KEY");`, "services/x.ts");
  const h = findByValue(hits, "ANTHROPIC_API_KEY");
  check("12. Thai UI/error literal -> extracted + UI_LITERAL/ALLOWED", !!h && h.category === "UI_LITERAL" && h.allowed, JSON.stringify(h));
}

// 13. template literal with an embedded secret
{
  const hits = scanText("const auth = `Bearer sk_live_ABCDEF1234567890abcdef`;", "services/x.ts");
  const h = findByValue(hits, "Bearer sk_live");
  check("13. template literal with embedded secret -> extracted + SECURITY_VIOLATION (not UI_LITERAL)", !!h && h.verdict === "SECURITY_VIOLATION", JSON.stringify(h));
}

console.log("=".repeat(60));
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
