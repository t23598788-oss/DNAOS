/**
 * Explicit minimal server-side DTO for the owner-display fields of the
 * Admin Operations workspace (Directive 007 step 5 / Security Cutover 008).
 *
 * WHY THIS EXISTS: owner-context.json is a full operator private registry
 * (identity incl. nickname/registration/location, thinking_style, design_rules,
 * likes/dislikes, current_work, priorities — 12 top-level sections). An
 * import'ing server component that passes the raw object as a prop publishes
 * ALL of it into the RSC/Flight payload, because TypeScript types do not
 * filter runtime data. So the ONLY sanctioned path is: the server page calls
 * buildOwnerDisplayDTO() and passes its result — this exact object shape, and
 * nothing more — to the client workspace component.
 *
 * Server-only ownership note: this module must never be imported from a
 * '"use client"' file; the registry stays behind app/admin/operations/ (guarded
 * by requireAuthPage + middleware) and core/runtime/dbd.ts (server runtime).
 */

/** The exact runtime shape the client workspace is allowed to receive. */
export interface OwnerDisplayDTO {
  identity: {
    company: string;
    email: string;
  };
  current_goals: {
    long_term: string;
  };
  philosophy: {
    core: string;
  };
}

/** Fields/types that must never be serialized into a client payload. */
export const FORBIDDEN_OWNER_CONTEXT_SECTIONS = [
  "name",
  "nickname",
  "role",
  "registration",
  "location",
  "business",
  "thinking_style",
  "design_rules",
  "likes",
  "dislikes",
  "current_work",
  "priorities",
  "policy",
] as const;

type RawOwnerContext = {
  identity?: Partial<OwnerDisplayDTO["identity"]>;
  current_goals?: Partial<OwnerDisplayDTO["current_goals"]>;
  philosophy?: Partial<OwnerDisplayDTO["philosophy"]>;
};

/**
 * Drops everything from the raw registry except the 5 displayed fields.
 * The output is a brand-new object — mutating or spreading it can never
 * resurrect unrelated sections of the source JSON.
 */
export function buildOwnerDisplayDTO(raw: unknown): OwnerDisplayDTO {
  const source = (raw ?? {}) as RawOwnerContext;
  const dto: OwnerDisplayDTO = {
    identity: {
      company: String(source.identity?.company ?? ""),
      email: String(source.identity?.email ?? ""),
    },
    current_goals: {
      long_term: String(source.current_goals?.long_term ?? ""),
    },
    philosophy: {
      core: String(source.philosophy?.core ?? ""),
    },
  };
  return dto;
}
