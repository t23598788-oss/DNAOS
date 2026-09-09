import { execFileSync } from "node:child_process";
import { AUTH_REQUIRED_EQUALS_PASS, NOT_AVAILABLE_EQUALS_PASS, type GateRunV1, type GateState } from "./types";
import { sourceAdmissionGates, VERIFICATION_GATES } from "./gates";
import { mcpQueenCycleAbsent } from "./circular";
import { repoRoot } from "./host-runtime";

function runGate(cwd: string, command: readonly string[], hermetic: boolean): { ok: boolean; detail: string } {
  const env: Record<string, string | undefined> = { ...process.env, npm_config_loglevel: "error" };
  if (hermetic) env.DNA_OS_HERMETIC_SOURCE = "1";
  else delete env.DNA_OS_HERMETIC_SOURCE;
  try {
    execFileSync(command[0]!, command.slice(1), {
      cwd,
      encoding: "utf8",
      timeout: 300_000,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    return { ok: true, detail: "pass" };
  } catch (error) {
    const extra = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
    const stdout = error && typeof error === "object" && "stdout" in error ? String((error as { stdout?: unknown }).stdout ?? "") : "";
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `${message}\n${stdout}\n${extra}`.slice(0, 4000) };
  }
}

export function classifyLiveDetail(detail: string): GateState {
  if (/AUTH_REQUIRED|unauthorized|401|credential/i.test(detail)) return "AUTH_REQUIRED";
  if (/NOT_AVAILABLE|ENOENT|ECONNREFUSED|language processor/i.test(detail)) return "NOT_AVAILABLE";
  return "FAIL";
}

export function runHermeticSourceProfile(cwd = repoRoot()): {
  readonly FULL_HERMETIC_SOURCE_VERIFICATION: boolean;
  readonly CIRCULAR_DEPENDENCY_CHECK: boolean;
  readonly results: readonly GateRunV1[];
} {
  const cycle = mcpQueenCycleAbsent(cwd);
  const results: GateRunV1[] = sourceAdmissionGates().map((gate) => {
    const ran = runGate(cwd, gate.command, true);
    return {
      gate_id: gate.gate_id,
      classification: gate.classification,
      state: ran.ok ? "PASS" : "FAIL",
      detail: ran.detail,
    };
  });
  results.push({
    gate_id: "circular-dependency",
    classification: "SOURCE_REQUIRED",
    state: cycle ? "PASS" : "FAIL",
    detail: cycle ? "ai-queen does not import tool-registry" : "cycle present",
  });
  const requiredFailed = results.some((row) => row.state === "FAIL");
  return {
    FULL_HERMETIC_SOURCE_VERIFICATION: !requiredFailed && cycle,
    CIRCULAR_DEPENDENCY_CHECK: cycle,
    results,
  };
}

export function runOptionalLiveGates(cwd = repoRoot()): readonly GateRunV1[] {
  return VERIFICATION_GATES.filter((row) => !row.required_for_source_admission).map((gate) => {
    const ran = runGate(cwd, gate.command, false);
    const state: GateState = ran.ok ? "PASS" : classifyLiveDetail(ran.detail);
    return { gate_id: gate.gate_id, classification: gate.classification, state, detail: ran.detail };
  });
}

export function liveStateForAdmission(state: GateState): "ignore" | "block" {
  if (state === "PASS") return "ignore";
  if (state === "AUTH_REQUIRED" || state === "NOT_AVAILABLE" || state === "NOT_APPLICABLE") return "ignore";
  return "block";
}

void NOT_AVAILABLE_EQUALS_PASS;
void AUTH_REQUIRED_EQUALS_PASS;

declare const process: { env: Record<string, string | undefined> };
