/**
 * หน้าที่: the input shape `control/ai-write-control/` accepts from an
 * External AI / Agent, before it is turned into a real `WriteIntent`.
 *
 * Input: none (pure type definitions).
 * Output: `RawWriteRequest`.
 * Dependency ที่อนุญาต: ../../contracts/write-intent/write-intent.ts (type only).
 * สิ่งที่ห้ามแตะ: never add a `decision`/`allow`/`approved` field here —
 * this shape is a REQUEST, and this folder never decides anything (Owner,
 * 2026-08-19: "ห้าม model ตัดสิน ALLOW/DENY เอง").
 */

import type { WriteIntentEvidenceRef, WriteOperation, WriteTargetType } from "../../contracts/write-intent/write-intent";

export interface RawWriteRequest {
  operation: WriteOperation;
  capability: string;
  target_type: WriteTargetType;
  target_path: string;
  requested_change: string;
  evidence?: readonly WriteIntentEvidenceRef[];
}
