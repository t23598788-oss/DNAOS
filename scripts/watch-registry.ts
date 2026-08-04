/**
 * DNA OS — Registry File Watcher (Dev Mode)
 *
 * เฝ้าดู core/**, gateway/**, engines/**, cognitive/**, presenter/**, services/**, plugins/**, registry/** และ app/** — ทุกครั้งที่ไฟล์เปลี่ยน:
 *   sync-registry.ts → build-arch-book.ts
 * ใช้ระหว่าง development เท่านั้น (npm run watch)
 *
 * File Existence Intelligence extension (owner, 2026-08-04): built directly
 * after a real incident (`rm -f` permanently lost an untracked file with no
 * detection/snapshot anywhere). Extends THIS watcher rather than a new one
 * per explicit instruction — real gap found live: the glob below only ever
 * watched `*.ts`, never `*.tsx`, so it would have missed "page 2.tsx" being
 * created entirely even if this extension had existed at the time. Fixed
 * both gaps together: added `.tsx`, and added real `add`/`unlink` handling
 * that calls the real File Existence Registry (register + snapshot on add,
 * mark missing-and-log on unlink) — never deletes anything itself.
 *
 * Dev Loop Pipeline extension (owner, 2026-08-05): opens one
 * dev_loop_sessions row for the life of this watch process, logs every
 * add/change/unlink as a dev_loop_evidence_events row (hash + git diff
 * summary — engines/workspace/evidenceStore.ts), then runs
 * scripts/impact-analyzer.ts against that evidence event, which writes a
 * pass/warning/fail verdict and — only if the path is unregistered — a
 * PROPOSED registry patch (never applied automatically). This is the "small
 * working loop": edit → evidence → impact → proposal → (Deploy Gate reads
 * the results later, see scripts/deploy-gate.ts).
 */

import chokidar from "chokidar";
import { execSync } from "child_process";
import { join } from "path";
import { readFileSync, existsSync } from "fs";
import { startSession, closeSession } from "../engines/workspace/devLoopSession";
import { logEvidenceEvent } from "../engines/workspace/evidenceStore";

const ROOT = join(__dirname, "..");
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Manual .env.local load — this script runs standalone via `npx tsx`, not
// inside Next.js, so nothing auto-loads it. Same pattern local-runtime/*.ts
// scripts already use.
try {
  const envFile = readFileSync(join(ROOT, ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    if (!line.includes("=") || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    const key = line.slice(0, i);
    if (!process.env[key]) process.env[key] = line.slice(i + 1);
  }
} catch {
  console.warn("[watch-registry] .env.local not found — file registration (DB writes) will fail, sync/arch-book still work");
}

let devLoopSessionId: string | null = null;
let devLoopSessionStarting: Promise<string | null> | null = null;

async function getDevLoopSession(): Promise<string | null> {
  if (devLoopSessionId) return devLoopSessionId;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!devLoopSessionStarting) {
    devLoopSessionStarting = (async () => {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      const session = await startSession(db, { owner: process.env.USER ?? "unknown", goal: "npm run watch — local dev loop" });
      devLoopSessionId = session.id;
      console.log(`  [dev-loop] session started: ${session.id}`);
      return session.id;
    })().catch((e) => {
      console.error("[watch-registry] dev-loop session start failed:", e.message);
      return null;
    });
  }
  return devLoopSessionStarting;
}

async function logDevLoopEvidence(relPath: string, eventType: "add" | "change" | "unlink") {
  const sessionId = await getDevLoopSession();
  if (!sessionId) return; // env not loaded — dev-loop evidence silently skipped, sync/arch-book above still ran
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const event = await logEvidenceEvent(db, sessionId, relPath, eventType);
    execSync(`npx tsx scripts/impact-analyzer.ts ${event.id}`, { cwd: ROOT, stdio: "inherit" });
  } catch (e: any) {
    console.error("[watch-registry] dev-loop evidence/impact failed:", e.message);
  }
}

function runSync(changedFile: string) {
  const timestamp = new Date().toLocaleTimeString("th-TH");
  console.log(`\n[${timestamp}] ตรวจพบการเปลี่ยนแปลง: ${changedFile}`);

  try {
    console.log("  → sync-registry...");
    execSync("npx tsx scripts/sync-registry.ts", { cwd: ROOT, stdio: "inherit" });

    console.log("  → build-arch-book...");
    execSync("npx tsx scripts/build-arch-book.ts", { cwd: ROOT, stdio: "inherit" });

    console.log(`  ✓ Registry อัปเดตแล้ว`);
  } catch (e) {
    console.error("  ✗ Error:", e);
  }
}

const watcher = chokidar.watch(
  [
    "core/**/*.{ts,tsx}", "gateway/**/*.{ts,tsx}", "engines/**/*.{ts,tsx}", "cognitive/**/*.{ts,tsx}",
    "presenter/**/*.{ts,tsx}", "services/**/*.{ts,tsx}", "plugins/**/*.{ts,tsx}", "registry/**/*.{ts,tsx}",
    "app/**/*.{ts,tsx}", "scripts/**/*.{ts,tsx}",
  ],
  {
    cwd: ROOT,
    ignored: [
      "**/node_modules/**",
      "**/.next/**",
      "**/*.d.ts",
    ],
    persistent: true,
    ignoreInitial: true,
  }
);

watcher.on("change", async (path) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runSync(path), 500);
  await logDevLoopEvidence(path, "change");
});

watcher.on("add", async (path) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runSync(path), 500);
  await onFileAdded(path).catch((e) => console.error("[watch-registry] file-existence registration failed:", e.message));
  await logDevLoopEvidence(path, "add");
});

watcher.on("unlink", async (path) => {
  await onFileRemoved(path).catch((e) => console.error("[watch-registry] file-existence unlink handling failed:", e.message));
  await logDevLoopEvidence(path, "unlink");
});

process.on("SIGINT", async () => {
  if (devLoopSessionId) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      await closeSession(db, devLoopSessionId);
    } catch (e: any) {
      console.error("[watch-registry] failed to close dev-loop session:", e.message);
    }
  }
  process.exit(0);
});

async function onFileAdded(relPath: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return; // env not loaded — real-registration silently skipped, sync/arch-book above still ran
  const { createClient } = await import("@supabase/supabase-js");
  const { registerFile } = await import("../engines/workspace/fileExistenceRegistry");
  const { createSnapshot } = await import("../engines/workspace/snapshotStore");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { dispatchEvent } = await import("../core/runtime/engine");
  dispatchEvent("FILE_DISCOVERED", "scripts/watch-registry", { path: relPath, timestamp: new Date().toISOString() });
  const record = await registerFile(db, relPath, { owningSession: "watch-registry" });
  console.log(`  [file-existence] registered ${relPath}: registration_state=${record.registration_state} active_or_duplicate=${record.active_or_duplicate}`);
  if (existsSync(join(ROOT, relPath))) {
    const content = readFileSync(join(ROOT, relPath), "utf-8");
    await createSnapshot(db, relPath, content, { sessionId: "watch-registry", command: "watch-registry:add", reason: "auto-snapshot on file creation" });
  }
}

async function onFileRemoved(relPath: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { dispatchEvent } = await import("../core/runtime/engine");
  console.log(`  [file-existence] ${relPath} removed from disk`);
  await db.from("file_existence_registry").update({ last_seen_at: new Date().toISOString() }).eq("path", relPath);
  dispatchEvent("FILE_MISSING", "scripts/watch-registry", { path: relPath, timestamp: new Date().toISOString() });
}

watcher.on("ready", () => {
  console.log("DNA OS Registry Watcher พร้อมทำงาน");
  console.log("  เฝ้าดู: core, gateway, engines, cognitive, presenter, services, plugins, registry, app/**/*.{ts,tsx}");
  console.log("  File Existence Intelligence: ไฟล์ใหม่จะถูก register + snapshot อัตโนมัติ, ไฟล์หายจะถูกบันทึก event");
  console.log("  กด Ctrl+C เพื่อหยุด\n");
});
