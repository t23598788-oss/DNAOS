export const RESOURCE_CONTROL_CONTRACT_VERSION = "1" as const;

export type ControlSurface = "APPLICATION_UI" | "OS_AUTOMATION" | "PROCESS" | "CLI" | "LOCAL_PROCESS" | "BROWSER" | "API";

export interface ResourceControlBinding {
  resource_id: string;
  control_surface: ControlSurface;
  authority_scope: string;
  execution_path: string;
  evidence_source: string;
  operations: readonly ("OBSERVE" | "ACTIVATE" | "FOCUS" | "INPUT" | "CLICK" | "LAUNCH" | "TERMINATE" | "READ_STATE" | "CAPTURE_RESULT")[];
}

export type BindingResult =
  | { ok: true; binding: ResourceControlBinding }
  | { ok: false; missing_fields: readonly string[] };

/** Typed composition point; execution remains owned by the referenced adapter. */
export function bindResourceControl(input: ResourceControlBinding): BindingResult {
  const missing: string[] = (["resource_id", "authority_scope", "execution_path", "evidence_source"] as const)
    .filter((field) => input[field].trim().length === 0);
  if (input.operations.length === 0) missing.push("operations");
  return missing.length > 0 ? { ok: false, missing_fields: missing } : { ok: true, binding: { ...input } };
}
