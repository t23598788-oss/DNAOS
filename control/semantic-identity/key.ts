/**
 * Deterministic machine key from canonical SemanticId.
 * Same SemanticId → same semantic_key always. No random UUIDs for type identity.
 */

import { createHash } from "node:crypto";
import { assertSemanticId } from "./id";
import type { SemanticId } from "./types";

export function semanticKey(id: SemanticId): string {
  const canonical = assertSemanticId(id);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
