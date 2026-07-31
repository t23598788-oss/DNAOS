// Real fix, 2026-07-30 (found live with the owner, via macOS system log
// `tccd`): the previous design had voice-wake-watcher.mjs (a Node.js
// process) directly spawn `rec` (sox) as a child — but Homebrew's node
// binary is NOT signed with the com.apple.security.device.audio-input
// entitlement, so macOS's hardened-runtime policy flatly denies microphone
// access for anything node spawns, with NO permission prompt ever shown
// ("Policy disallows prompt for Sub:{/usr/local/bin/node}... access to
// kTCCServiceMicrophone denied" — verified directly via `log show
// --predicate 'subsystem == "com.apple.TCC"'`, not guessed). Real fix:
// voice-wake-watcher.sh (a plain bash script, launched directly by
// launchd) now owns the actual `rec`/whisper-cli calls — bash IS grantable
// real TCC microphone permission. This tiny Node script is only invoked
// AFTER a wake word is already confirmed by the shell script, purely to do
// the Supabase insert (no microphone access needed for that step, so no
// entitlement problem here).
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join } from "path";

const PROJECT_DIR = "/Users/tam/Desktop/DNA OS-โฟลเดอร์หลักต้นฉบับ /dna-os-deadboard";
const env = Object.fromEntries(
  readFileSync(join(PROJECT_DIR, ".env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const transcript = process.argv.slice(2).join(" ");
const { error } = await db.from("voice_wake_events").insert({ transcript });
if (error) {
  console.error(`[report-wake] insert failed: ${error.message}`);
  process.exit(1);
}
console.log(`[report-wake] wake word reported: "${transcript}"`);
