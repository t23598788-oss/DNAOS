/**
 * Safe registry writer — the intended entry point for any edit to a
 * registry/*.json file, per Constitution Rule 116 ("ทุกการแก้ไขทรัพยากรของ
 * ระบบ...ต้องผ่าน Runtime, Lock Manager, Dependency Registry และ Validation
 * Pipeline ก่อน Commit เสมอ").
 *
 * Scope, stated honestly: JSON registries only. core/shared/types.ts is
 * real TypeScript source, not JSON — mutating it programmatically would need
 * an AST-based codemod, which doesn't exist yet (see roadmap). Editing
 * types.ts today still means acquireLock/releaseLock around a normal
 * Read+Edit, not this helper — a real, documented gap, not silently assumed
 * covered.
 *
 * Bigger limitation, stated up front: this module cannot force a different
 * AI session or a human to call it instead of editing the file directly —
 * no code in this repository can intercept another process's Edit/Write
 * tool call or a plain `vim registry/x.json`. What it DOES guarantee: any
 * caller that uses withRegistryLock (this session included, going forward)
 * gets real atomic protection against a concurrent writer using the SAME
 * discipline. See registry/rule-coverage.json rule 116 for this boundary
 * stated the same way every other partially-enforced rule in this repo is.
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withLock } from "./lockManager";

const PROJECT_ROOT = join(__dirname, "../..");

export async function withRegistryLock<T>(
  db: SupabaseClient,
  relativePath: string,
  actor: string,
  sessionId: string,
  mutate: (current: unknown) => unknown
): Promise<T> {
  const absPath = join(PROJECT_ROOT, relativePath);
  const resourceType = relativePath.endsWith(".ts") ? "file" : "registry";

  return withLock(db, resourceType, relativePath, actor, sessionId, async () => {
    const before = JSON.parse(readFileSync(absPath, "utf-8"));
    const after = mutate(before);
    writeFileSync(absPath, JSON.stringify(after, null, 2) + "\n", "utf-8");
    return after as T;
  });
}
