/** ตรวจว่ามีใครเป็นเจ้าของ path ใต้ tests/ อยู่แล้วไหม (duplicate/overlap gate) */
import { inspectWriteOwnershipIndex } from "../../software/capability-registrar/contract";
const idx = inspectWriteOwnershipIndex() as unknown as Record<string, unknown>;
const rows = (idx.entries ?? idx.registryIndex ?? []) as readonly Record<string, string>[];
console.log("ownership entries:", rows.length);
const tests = rows.filter((r) => String(r.OWNED_PATH ?? r.OWNER_FOLDER ?? "").startsWith("tests"));
console.log("ที่ครอบ tests*:", tests.length, JSON.stringify(tests.slice(0, 5)));
console.log("ตัวอย่าง entry:", JSON.stringify(rows[0]));
console.log("REGISTRY_SOURCE ที่มี:", JSON.stringify([...new Set(rows.map((r) => r.REGISTRY_SOURCE))]));
