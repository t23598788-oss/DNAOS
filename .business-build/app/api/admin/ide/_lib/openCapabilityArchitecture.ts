/**
 * Open Capability Architecture Foundation (owner, 2026-08-07, Software
 * Factory Step 10, Phase 9). This is a STRUCTURE ONLY, preparing real
 * contracts for a future Capability ecosystem — no real Community/
 * Country/Legal Capability exists yet, and no real Review Process runs
 * yet. Every real, existing Capability today comes exclusively from
 * registry/capability-registry.json (Business/Core categories); this
 * file never adds to or duplicates that real registry (Rule 103,
 * Constitution Principle 1 — Capability First: never duplicate a
 * capability).
 *
 * Constitution Principle 2 — Factory Owns Knowledge: all real knowledge
 * belongs to DNA OS, never to an AI provider.
 * Constitution Principle 3 — Provider Independence: every real provider
 * is a Plugin, never Core.
 * Constitution Principle 6 — Community Capability: real, qualified
 * experts may contribute a real Capability under DNA OS's real
 * Constitution — but only through the real Review Process this file
 * declares the contract for, never bypassing it.
 */

export type CapabilityOrigin = "CORE" | "COMMUNITY" | "COUNTRY" | "BUSINESS" | "LEGAL";

export interface CommunityCapabilityContract {
  proposedCapabilityId: string;
  contributor: string; // real, identified contributor — never anonymous
  origin: "COMMUNITY";
  requiresReview: true; // real, non-negotiable — no Community Capability skips Review
}
export interface CountryCapabilityContract {
  proposedCapabilityId: string;
  countryCode: string; // real ISO 3166-1 alpha-2, must match a real Country Package (Phase 7) once one exists
  origin: "COUNTRY";
  requiresReview: true;
}
export interface BusinessCapabilityContract {
  proposedCapabilityId: string;
  businessDomain: string;
  origin: "BUSINESS";
  requiresReview: true;
}
export interface LegalCapabilityContract {
  proposedCapabilityId: string;
  jurisdiction: string;
  origin: "LEGAL";
  requiresReview: true;
}

/** Real, mandatory Review Process every proposed Capability (Community/
 * Country/Business/Legal) must pass — never bypassable, never AI-only. */
export interface ReviewProcessStep {
  step: string;
  description: string;
  requiredEvidence: string[];
  automatable: boolean;
  status: "NOT_IMPLEMENTED"; // real, honest — no real Review Process runner exists yet
}
export const REVIEW_PROCESS: ReviewProcessStep[] = [
  { step: "Constitution Conformance", description: "Real check that the proposed Capability's real contract matches this file's real CapabilityContract shape", requiredEvidence: ["proposed manifest"], automatable: true, status: "NOT_IMPLEMENTED" },
  { step: "Duplicate Check", description: "Real check against registry/capability-registry.json's real, existing CapabilityIds — reuses the SAME real registry, never a second one", requiredEvidence: ["registry/capability-registry.json real read"], automatable: true, status: "NOT_IMPLEMENTED" },
  { step: "Factory Acceptance", description: "Real, human Factory review against Factory Acceptance Rules below — never an AI-only approval", requiredEvidence: ["real human reviewer identity", "real reason"], automatable: false, status: "NOT_IMPLEMENTED" },
  { step: "Evidence Requirements", description: "Real check that the proposal cites real, verifiable evidence for every claim it makes", requiredEvidence: ["real, verifiable evidence per claim"], automatable: true, status: "NOT_IMPLEMENTED" },
];

/** Real Evidence Requirements every proposed Capability must satisfy —
 * mirrors the SAME real Evidence Warehouse discipline (Step 5) every
 * other Artifact in this Factory already follows; never a separate,
 * lower bar for a Community/Country Capability. */
export interface EvidenceRequirement {
  requirement: string;
  reason: string;
}
export const EVIDENCE_REQUIREMENTS: EvidenceRequirement[] = [
  { requirement: "real, identified contributor (never anonymous)", reason: "Factory Owns Knowledge — provenance must always be real and traceable" },
  { requirement: "real test coverage for the proposed Capability's real InputContract/OutputContract", reason: "same real discipline registry/capability-registry.json's existing 202 real capabilities already follow" },
  { requirement: "real Factory Ownership assignment (never UNKNOWN/CONFLICT at merge time)", reason: "same real discipline registry/factory-mapping.json already enforces for every other real module" },
];

/** Real Factory Acceptance Rules — a proposed Capability is rejected
 * (never silently merged) if any rule fails. No real approval runner
 * exists yet; this is the real, declared rule SET a future runner would
 * enforce. */
export interface FactoryAcceptanceRule {
  rule: string;
  status: "NOT_IMPLEMENTED";
}
export const FACTORY_ACCEPTANCE_RULES: FactoryAcceptanceRule[] = [
  { rule: "Capability First — reject if a real, functionally-equivalent CapabilityId already exists in registry/capability-registry.json", status: "NOT_IMPLEMENTED" },
  { rule: "Provider Independence — reject if the proposed Capability directly imports a real third-party provider SDK into Core rather than a real Plugin boundary", status: "NOT_IMPLEMENTED" },
  { rule: "Evidence Complete — reject if any EVIDENCE_REQUIREMENTS entry above is unmet", status: "NOT_IMPLEMENTED" },
  { rule: "Human Approval Required — reject if approval was AI-only with no real human reviewer identity", status: "NOT_IMPLEMENTED" },
];

export function getOpenCapabilityArchitectureStatus(): { reviewProcessSteps: number; evidenceRequirements: number; acceptanceRules: number; status: "NOT_IMPLEMENTED"; evidence: string } {
  return {
    reviewProcessSteps: REVIEW_PROCESS.length, evidenceRequirements: EVIDENCE_REQUIREMENTS.length, acceptanceRules: FACTORY_ACCEPTANCE_RULES.length,
    status: "NOT_IMPLEMENTED",
    evidence: "real, declared framework only — no real Review Process runner, no real Community/Country/Legal Capability submission path exists yet in this repo",
  };
}
