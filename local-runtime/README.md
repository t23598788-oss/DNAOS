# local-runtime

Real, persistent workers that run on the owner's own Mac, not on Vercel/Supabase — cloud genuinely cannot reach a home WiFi network, and there's no cloud AI budget (owner, 2026-07-25: "ย้ายทุกอย่างมาประมวลผลในเครื่อง Mac"). See CLAUDE.md's "Local-AI Pipeline Responsibility Split" section for the full architecture.

Committed here (2026-07-31) so this isn't floating outside git — previously lived only at `~/dna-os-ollama/` with no version control.

## Files

- `ai-task-watcher.mjs` — polls `ai_tasks` every 20s, classifies LINE documents via Ollama vision, drafts conversational replies, posts results to the `ai-callback` Edge Function. Also self-heals: each cycle it scans for any LINE document that was never actually processed (checked against both `ai_tasks` and `receipt_documents`, so already-completed work is never re-queued) and enqueues exactly the real gap.
- `print-watcher.mjs` — physical printer job queue.
- `watch-drive.mjs` — Google Drive ingestion.
- `voice-wake-watcher.mjs` / `.sh` / `report-wake.mjs` / `voice-print.mjs` — voice wake-word pipeline.
- `backfill-slips.mjs` / `backfill-slips-test.mjs` — manual one-off backfill tool for historical payment slips.
- `Modelfile` — Ollama Modelfile for the `thawatchai` custom model.
- `launchagents/*.plist` — macOS LaunchAgent configs that keep the watchers running forever, independent of any chat/Claude session.

## Installing on a Mac

```bash
mkdir -p ~/dna-os-ollama
cp local-runtime/*.mjs local-runtime/*.sh local-runtime/Modelfile local-runtime/package.json ~/dna-os-ollama/
ln -s "$(pwd)/node_modules" ~/dna-os-ollama/node_modules
cp local-runtime/launchagents/*.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.dnaos.ai-task-watcher.plist
# repeat launchctl load for the other three plists as needed
```

Requires `AI_CALLBACK_SECRET` (and the usual `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`) in the main project's `.env.local` — these scripts read that file directly (`PROJECT_DIR` constant at the top of each script).
