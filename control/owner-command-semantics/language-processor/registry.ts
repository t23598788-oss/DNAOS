/**
 * The single implementation registry for language/reasoning processors.
 *
 * A processor translates text into an untrusted structured proposal only.
 * It never receives a capability registry writer, credentials, policy grant,
 * adapter, executor, or an execution function.  DNA OS retains those at the
 * command-router and execution boundaries.
 */
import {
  runFixedLocalQwenProcessor,
  type LanguageProcessorOutcome,
  type LanguageProcessorRequestOptions,
} from "./fixed-runner";

export type LanguageProcessorAvailability = "AVAILABLE" | "UNAVAILABLE";

export interface LanguageProcessorRegistration {
  readonly processor_id: string;
  readonly canonical_name: string;
  readonly provider_kind: "LOCAL" | "EXTERNAL";
  readonly purpose: string;
  readonly input_contract: readonly string[];
  readonly output_contract: readonly string[];
  readonly credential_requirement: null;
  readonly has_execution_authority: false;
  readonly has_tool_authority: false;
  readonly availability: LanguageProcessorAvailability;
  readonly runtime_entry: string;
  readonly evidence_refs: readonly string[];
  readonly invoke: (rawText: string, sandboxDir?: string, options?: LanguageProcessorRequestOptions) => LanguageProcessorOutcome;
}

const LOCAL_QWEN: LanguageProcessorRegistration = Object.freeze({
  processor_id: "local-qwen-semantic-processor",
  canonical_name: "local-qwen-semantic-processor",
  provider_kind: "LOCAL",
  purpose: "Translate Owner text into untrusted structured semantic fields for deterministic DNA OS validation.",
  input_contract: ["raw Owner text", "optional fixed classification mode", "optional closed candidate list"],
  output_contract: ["raw model stdout", "validated semantic proposal or failure"],
  credential_requirement: null,
  has_execution_authority: false,
  has_tool_authority: false,
  availability: "AVAILABLE",
  runtime_entry: "control/owner-command-semantics/language-processor/fixed-runner.ts#runFixedLocalQwenProcessor",
  evidence_refs: [
    "control/owner-command-semantics/run-semantic.sh",
    "control/owner-command-semantics/semantic-runner.py",
    "control/owner-command-semantics/language-processor/fixed-runner.ts",
  ],
  invoke: runFixedLocalQwenProcessor,
});

const PROCESSORS: ReadonlyMap<string, LanguageProcessorRegistration> = new Map([[LOCAL_QWEN.processor_id, LOCAL_QWEN]]);
const ACTIVE_PROCESSOR_ID = LOCAL_QWEN.processor_id;

export function listLanguageProcessors(): readonly LanguageProcessorRegistration[] {
  return [...PROCESSORS.values()];
}

export function getLanguageProcessor(processorId: string): LanguageProcessorRegistration | null {
  return PROCESSORS.get(processorId) ?? null;
}

/** No owner text or language-model output may select this processor. */
export function activeLanguageProcessor(): LanguageProcessorRegistration {
  return PROCESSORS.get(ACTIVE_PROCESSOR_ID)!;
}

export function runLanguageProcessor(rawText: string, sandboxDir?: string, options?: LanguageProcessorRequestOptions): LanguageProcessorOutcome {
  return activeLanguageProcessor().invoke(rawText, sandboxDir, options);
}
