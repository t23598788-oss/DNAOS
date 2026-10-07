/**
 * Step 8 — Own-Machine Core boot contract (CURRENT TypeScript Core).
 * Not a new secret architecture. Not a supervisor. Not a second registry.
 *
 * Input: none (closed env-name lists).
 * Output: required Core boot env names; optional-provider env names that
 * must not be required for Core startup.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามใส่ค่า secret; ห้ามบังคับ RAILWAY_* สำหรับ boot.
 */

/** Existing shared-secret names. Do not rename in Step 8. */
export const CORE_BOOT_REQUIRED_ENV = [
  "OWNER_COMMAND_HTTP_SHARED_SECRET",
] as const;

/** Already legitimate deployment/user seams. Not required for Core HTTP boot. */
export const CORE_BOOT_OPTIONAL_ENV = [
  "JOINT_MONITOR_SHARED_SECRET",
  "JOINT_MONITOR_URL",
  "DNA_OS_CIRCUIT_SHARED_SECRET",
  "HOST",
  "PORT",
  "DNA_OS_STATE_ROOT",
] as const;

/**
 * Optional-provider material. Core on generic Linux must boot when these
 * are unset. Adapters may still read them when present.
 */
export const CORE_BOOT_MUST_NOT_REQUIRE_ENV = [
  "RAILWAY_PROJECT_TOKEN",
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_SERVICE_ID",
  "RAILWAY_DEPLOYMENT_ID",
  "VERCEL_TOKEN",
] as const;

export const OWN_MACHINE_CORE_CONTRACT_ID = "dna-os/own-machine-core-boot" as const;
