#!/usr/bin/env npx tsx
/**
 * AI Code Generation gate (HCG-P2, integration point 7).
 * registry/CURRENT_STATE.json plan_lock.exceptions_log -> HCG.
 * registry/hardcode-governance/enforcement-config.json -> integration_points.ai_code_generation.
 *
 * Claude Code PreToolUse hook for Write|Edit. Reads the tool-call JSON on
 * stdin, and — only for file paths under the critical-path allowlist —
 * classifies the newly-written/edited content via
 * engines/governance/hardcode-decision-engine.ts's scanText(). BLOCK_CRITICAL:
 * denies (hookSpecificOutput.permissionDecision:"deny") only on
 * SECURITY_VIOLATION/ARCHITECTURE_VIOLATION verdicts.
 *
 * HCG Phase 2.6 (Hook Noise Cleanup): a value the Decision Engine itself
 * already resolved to ALLOWED/ALLOWED_WITH_REGISTRATION passes silently —
 * warning about a value the engine just approved was a real bug (found
 * live during HCG Phase 2.5 stabilization testing: a valid MIME type
 * literal triggered a "flagged for review" warning even though its own
 * verdict was ALLOWED). Everything else non-critical (UNKNOWN, MOVE_TO_ENV,
 * MOVE_TO_REGISTRY, MOVE_TO_CONFIG, MOVE_TO_DATABASE, DUPLICATED_CONSTANT)
 * is still reported via systemMessage but allowed — this phase is not
 * STRICT, and BLOCK_CRITICAL's own scope (SECURITY_VIOLATION/
 * ARCHITECTURE_VIOLATION, critical-path files only) is unchanged.
 *
 * Paths outside the allowlist, or tool calls this hook can't parse, allow
 * silently and fast (no scan cost on the vast majority of writes).
 */
import { join, relative } from "path";
import { scanText } from "@/engines/governance/hardcode-decision-engine";
import enforcementConfig from "@/registry/hardcode-governance/enforcement-config.json";

const ROOT = join(__dirname, "..");
const criticalPrefixes: string[] = enforcementConfig.critical_path_allowlist;

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    // No stdin (e.g. manual invocation without a pipe) — resolve empty after a tick.
    if (process.stdin.isTTY) resolve("");
  });
}

function allow(systemMessage?: string) {
  const out: Record<string, unknown> = {};
  if (systemMessage) out.systemMessage = systemMessage;
  console.log(JSON.stringify(out));
  process.exit(0);
}

function deny(reason: string) {
  console.log(
    JSON.stringify({
      systemMessage: reason,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

async function main() {
  const raw = await readStdin();
  if (!raw) return allow();

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return allow(); // malformed input — fail open, don't break the write
  }

  const toolName = payload.tool_name;
  if (toolName !== "Write" && toolName !== "Edit") return allow();

  const filePath: string | undefined = payload.tool_input?.file_path;
  if (!filePath) return allow();

  const relPath = relative(ROOT, filePath).split("\\").join("/");
  const inScope = criticalPrefixes.some((p) => relPath.startsWith(p));
  if (!inScope) return allow();

  const content: string = payload.tool_input?.content ?? payload.tool_input?.new_string ?? "";
  if (!content) return allow();

  const findings = scanText(content, relPath);
  const critical = findings.filter((f) => f.verdict === "SECURITY_VIOLATION" || f.verdict === "ARCHITECTURE_VIOLATION");
  // ALLOWED / ALLOWED_WITH_REGISTRATION pass silently (Phase 2.6) — the
  // engine already approved these, warning about them is noise, not signal.
  // Everything else non-critical (UNKNOWN included) is still reportable.
  const reportable = findings.filter(
    (f) =>
      f.verdict !== "SECURITY_VIOLATION" &&
      f.verdict !== "ARCHITECTURE_VIOLATION" &&
      f.verdict !== "ALLOWED" &&
      f.verdict !== "ALLOWED_WITH_REGISTRATION"
  );

  if (critical.length > 0) {
    const list = critical.map((f) => `"${f.value}" -> ${f.category}/${f.verdict} (${f.rationale})`).join("; ");
    return deny(
      `[hardcode-governance][BLOCK_CRITICAL] ${relPath}: ${critical.length} critical finding(s) — ${list}. Move to Environment Variable / Secret Provider (or fix the underlying value) before writing. Run hardcode.classify / hardcode.explain to review, or hardcode.register_exception if this is a reviewed, legitimate exception.`
    );
  }

  if (reportable.length > 0) {
    const list = reportable.map((f) => `"${f.value}" -> ${f.category}/${f.verdict}`).join("; ");
    return allow(`[hardcode-governance][REPORT_ONLY] ${relPath}: ${reportable.length} value(s) flagged for review (not blocked) — ${list}`);
  }

  return allow();
}

main();
