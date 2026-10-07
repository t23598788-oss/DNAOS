/**
 * หน้าที่: types for the shared-secret network auth gate. Pure data
 * shapes only — no I/O, no HTTP framework coupling.
 */

export interface BindPolicyDecision {
  readonly allowed: boolean;
  readonly reason: string;
}
