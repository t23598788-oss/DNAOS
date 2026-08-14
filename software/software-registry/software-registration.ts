/**
 * หน้าที่: the record that says a given Software type has been registered
 * and is known to the system — distinct from software.ts's Software,
 * which only defines what it IS.
 *
 * Input: a Software (see ./software.ts).
 * Output: `SoftwareRegistration`.
 * Dependency ที่อนุญาต: ./software.ts.
 * สิ่งที่ห้ามแตะ: source-code-level model only — no real database wired
 * to this file yet.
 *
 * NOT_YET_BUILT: no real Software has been registered.
 */

import type { Software } from "./software";

export interface SoftwareRegistration {
  software: Software;
  registered_at: string;
}
