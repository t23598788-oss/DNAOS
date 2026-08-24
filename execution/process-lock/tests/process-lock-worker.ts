/**
 * หน้าที่: a real, separate OS process (launched via `npx tsx` by
 * ../tests/process-lock.test.ts's real cross-process test) that attempts
 * one `acquireLock` call and prints the real result to stdout. Not a
 * simulation — this file's only job is to BE one contending process.
 */

import { acquireLock } from "../contract";

const [, , lockKey, holderId] = process.argv;
const result = acquireLock({ lock_key: lockKey, holder_id: holderId, lease_ms: 10_000 });
process.stdout.write(result.status);
