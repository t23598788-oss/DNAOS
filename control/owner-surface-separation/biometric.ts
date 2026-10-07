/**
 * OWNER_BIOMETRIC_DEVELOPMENT_GATE_V1 — native LocalAuthentication only.
 * No checkbox, password field, confirmation button, or AppleScript.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createChallenge, runVerification, ownerPresence, type VerificationOutcome } from "../owner-authentication/human-verification";
import type { BiometricAvailability } from "./types";

const HELPER = join(process.cwd(), "control/owner-authentication/native/owner-verify");

export interface BiometricPort {
  readonly probe: () => { availability: Exclude<BiometricAvailability, "FAILED" | "OWNER_CANCELLED">; helper_present: boolean };
  readonly evaluate: (input: {
    readonly expected_owner: string;
    readonly purpose: string;
    readonly work_id: string;
    readonly scope_preview: Record<string, unknown>;
  }) => VerificationOutcome;
}

export function probeNativeBiometric(): { availability: "AVAILABLE" | "NOT_AVAILABLE"; helper_present: boolean; BIOMETRIC_IMPLEMENTATION: string } {
  const helper_present = existsSync(HELPER);
  if (!helper_present) {
    return { availability: "NOT_AVAILABLE", helper_present: false, BIOMETRIC_IMPLEMENTATION: "control/owner-authentication/native/OwnerVerify.swift LocalAuthentication" };
  }
  return { availability: "AVAILABLE", helper_present: true, BIOMETRIC_IMPLEMENTATION: "control/owner-authentication/native/OwnerVerify.swift LocalAuthentication" };
}

export const productionBiometricPort: BiometricPort = {
  probe: () => {
    const row = probeNativeBiometric();
    return { availability: row.availability, helper_present: row.helper_present };
  },
  evaluate: (input) => {
    const owner = input.expected_owner || ownerPresence() || "unknown";
    const created = createChallenge({
      expected_owner: owner,
      purpose: input.purpose,
      requested_authority_class: "CLASS_3_SECURITY_OR_EXTERNAL_CONFIG",
      work_id: input.work_id,
    });
    if (!created.ok) {
      return {
        challenge_id: "none",
        outcome: created.reason_code === "NO_CONSOLE_SESSION" ? "UNAVAILABLE" : "DENIED",
        verification_method_class: null,
        verified_at: null,
        error_code: created.reason_code,
        detail: created.detail,
      };
    }
    return runVerification(created.challenge.challenge_id);
  },
};

let activePort: BiometricPort = productionBiometricPort;

export function setBiometricPort(port: BiometricPort | null): void {
  activePort = port ?? productionBiometricPort;
}

export function biometricPort(): BiometricPort {
  return activePort;
}

export function mapBiometricOutcome(outcome: VerificationOutcome): BiometricAvailability {
  if (outcome.outcome === "VERIFIED") return "AVAILABLE";
  if (outcome.outcome === "UNAVAILABLE") return "NOT_AVAILABLE";
  if (outcome.outcome === "CANCELLED") return "OWNER_CANCELLED";
  return "FAILED";
}
