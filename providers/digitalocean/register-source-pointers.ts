/**
 * หน้าที่: registers every DigitalOcean SourcePointer in ./sources/source-map.ts
 * through the shared, generic `../_shared/source-registry/registration.ts`
 * — Section 10/14 (Owner correction): Candidate -> Duplicate Gate ->
 * Registry Writer -> Persistent Software Registry, the same real,
 * unmodified pipeline `providers/hostinger/register-candidates.ts`
 * already proved works. Idempotent — re-running reports DUPLICATE for
 * every already-registered source, never a second row.
 *
 * How to run: npx tsx providers/digitalocean/register-source-pointers.ts
 */

import { registerAllSourcePointers } from "../_shared/source-registry/registration";
import { DIGITALOCEAN_SOURCE_POINTERS } from "./sources/source-map";

for (const { source_id, result } of registerAllSourcePointers(DIGITALOCEAN_SOURCE_POINTERS)) {
  console.log(JSON.stringify({ source_id, result }));
}
