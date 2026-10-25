/**
 * Security Target Runtime (owner, 2026-08-08, Software Factory Step
 * 13.25, Section 5). Real, deterministic Target declaration validation
 * — every field is required; a Target missing any real field is
 * honestly rejected. No Execution Gate request may reference an
 * undeclared/invalid Target (enforced in securityExecutionRuntime.ts).
 */
export interface TargetDeclaration {
  owner: string;
  organization: string;
  asset: string;
  purpose: string;
  authorization: string;
  expectedOutcome: string;
  allowedRuntime: string[];
  forbiddenRuntime: string[];
}

export interface TargetValidationResult {
  valid: boolean;
  missingFields: string[];
}

const REQUIRED_FIELDS: (keyof TargetDeclaration)[] = ["owner", "organization", "asset", "purpose", "authorization", "expectedOutcome"];

export function validateTarget(target: Partial<TargetDeclaration>): TargetValidationResult {
  const missingFields: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    const v = target[f];
    if (typeof v !== "string" || v.trim().length === 0) missingFields.push(f);
  }
  if (!Array.isArray(target.allowedRuntime) || target.allowedRuntime.length === 0) missingFields.push("allowedRuntime");
  if (!Array.isArray(target.forbiddenRuntime)) missingFields.push("forbiddenRuntime");
  return { valid: missingFields.length === 0, missingFields };
}
