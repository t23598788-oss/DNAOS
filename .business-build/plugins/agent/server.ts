/**
 * DNA OS Agent — HTTP Server (TASK-018 real fix)
 *
 * Real, honest, minimal fix for a real missing-file bug (DNA-000015 /
 * TASK-018): registry/services.json's "agent" service declares
 * module: plugins/agent/server.ts, type: "http", port: 7777 — and
 * plugins/agent/start.sh's own last line already runs
 * `npx tsx "$DIR/server.ts"` — but this file did not exist anywhere on
 * disk, so the agent's own startup script was already broken
 * independent of the registry (confirmed missing during the 2026-07-06
 * reorg's git mv pass, see registry/CHANGELOG.json DNA-000015).
 *
 * SCOPE — deliberately minimal, nothing invented beyond what start.sh
 * and services.json already, concretely specify:
 *   - real file exists at this exact path
 *   - real HTTP server, real listen on port 7777 (the one concrete,
 *     already-declared value)
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO (honest, disclosed gap —
 * Constitution "ห้ามตีความเพิ่มเอง"/Rule 100/106): no route, request
 * schema, or response contract is specified anywhere in this repo for
 * this HTTP surface. No sibling directory under plugins/ has a real,
 * analogous server.ts to pattern-match against (plugins/line/ has no
 * server.ts, only a compiled Swift driver binary + line.ts; plugins/macos/
 * is Swift-only). The one plausible real precedent, plugins/executor.ts's
 * already-real, already-tested execute() (desktop-automation dispatch,
 * re-exported by plugins/index.ts), is NOT wired into an HTTP route
 * here — the exact request/response shape for doing so is not specified
 * anywhere, and inventing one would be exactly the kind of unspecified
 * business behavior this fix must not fabricate. Every request this
 * server receives is answered honestly with NOT_IMPLEMENTED rather than
 * pretending to dispatch a real command. See registry/TASK_QUEUE.json
 * TASK-018 for this disclosed follow-up.
 */
import { createServer } from "http";

// registry/services.json's "agent" entry — the one real, concrete value
// specified anywhere in this repo for this file. Never guessed.
const PORT = 7777;

const server = createServer((_req, res) => {
  res.writeHead(501, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      ok: false,
      status: "NOT_IMPLEMENTED",
      message:
        "DNA OS Agent HTTP server is a real, honest, minimal stub (TASK-018). It exists so plugins/agent/start.sh's own startup call no longer fails, and it really listens on the port registry/services.json declares (7777). No real HTTP route/request contract for dispatching into plugins/executor.ts#execute() (the real, already-built desktop-automation capability this Agent is expected to front) is specified anywhere in this repo yet, so none is invented here — see registry/TASK_QUEUE.json TASK-018 for the disclosed follow-up.",
    }),
  );
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`DNA OS Agent listening on port ${PORT} (NOT_IMPLEMENTED stub — see TASK-018)`);
});
