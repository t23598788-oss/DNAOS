import type { ClassifiedPath, PathClass } from "./types";

const ADMITTED: ReadonlySet<PathClass> = new Set(["SOURCE_ELIGIBLE", "TEST_ELIGIBLE", "DOCUMENTATION_ELIGIBLE"]);

export function classifyPath(path: string): PathClass {
  const p = path.replaceAll("\\", "/");
  const name = p.split("/").pop() ?? p;
  const lower = p.toLowerCase();
  const inFixtures = p.includes("/fixtures/");
  const isCode = name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".js") || name.endsWith(".swift");

  if (!isCode && (name.startsWith(".env") || name.endsWith(".pem") || name.endsWith(".key"))) {
    return "CREDENTIAL_OR_SECRET_STATE";
  }
  if (!isCode && p.startsWith("credentials/") && (name.endsWith(".jsonl") || p.includes("/data/"))) {
    return "CREDENTIAL_OR_SECRET_STATE";
  }
  if (p.startsWith("audit/") || name.endsWith("-audit.jsonl") || lower.includes("keychain-audit.jsonl")) {
    return "AUDIT_DATA";
  }
  if (name.endsWith(".jsonl")) return "RUNTIME_DATA";
  if (!inFixtures && p.includes("/data/") && (name.endsWith(".json") || name.endsWith(".png") || name.endsWith(".jpg"))) {
    return "RUNTIME_DATA";
  }
  if (p.startsWith("local-runtime/") || p.includes("/dist/") || name.endsWith(".log") || p.includes("node_modules/") || p.includes("tests/__sandbox__/")) {
    return "CACHE_TEMP";
  }
  if (p.includes("tests/__pipeline__/") && !isCode) {
    return "CACHE_TEMP";
  }
  if (p.includes("/data/screenshots/") || name.endsWith(".png") && p.includes("/ui-verification")) {
    return "CACHE_TEMP";
  }
  if (p.includes("/canonical-det-") || /\/data\/[^/]+-\d{10,}/.test(p)) {
    return "RUNTIME_DATA";
  }
  if (name === "owner-verify" && p.includes("/native/")) return "CACHE_TEMP";
  if (inFixtures) return p.includes("/tests/") || name.includes(".test.") ? "TEST_ELIGIBLE" : name.endsWith(".md") ? "DOCUMENTATION_ELIGIBLE" : "TEST_ELIGIBLE";
  if (p.includes("/tests/") || p.startsWith("tests/") || name.endsWith(".test.ts") || name.endsWith(".test.js")) return "TEST_ELIGIBLE";
  if (name === ".gitignore" || name.endsWith(".md")) return "DOCUMENTATION_ELIGIBLE";
  if (name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".js") || name.endsWith(".swift") || name.endsWith(".sql") || name.endsWith(".css") || name.endsWith(".html") || name.endsWith(".plist") || name === ".gitkeep") {
    return "SOURCE_ELIGIBLE";
  }
  if (name.endsWith(".json") && !p.includes("/data/")) return "SOURCE_ELIGIBLE";
  return "UNKNOWN";
}

export function classifiedRow(path: string): ClassifiedPath {
  const classification = classifyPath(path);
  return { path, classification, admitted: ADMITTED.has(classification) };
}

export function isAdmittedPathClass(classification: PathClass): boolean {
  return ADMITTED.has(classification);
}
