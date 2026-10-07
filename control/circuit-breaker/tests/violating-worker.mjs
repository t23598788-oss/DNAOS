#!/usr/bin/env node
// Real fixture for ./kill-on-violation-proof.test.ts — launched through
// control/agent-host/'s real sandbox-exec confinement (same as
// control/agent-host/agent-script.mjs's own convention). Writes ONE real
// .ts file, inside its own confined workspace, containing a genuine
// Capability Folder Law import-boundary violation (a relative import that
// resolves to a real file in a DIFFERENT capability folder, not a
// contract.ts) — then sleeps, so ./daemon.ts's poll loop has a real window
// to detect it and (when enforce=true) kill this process while it is
// still alive. Never simulates the violation as a string/log line — a
// real file, with a real import statement, checkImportBoundaries() itself
// resolves against the real filesystem.
import fs from "node:fs";
import path from "node:path";

const [, , relPath, sleepMs] = process.argv;
const target = path.join(process.cwd(), relPath);
fs.writeFileSync(target, 'import type { Task } from "../../../agent-gateway/types";\nexport {};\n');
process.stdout.write(JSON.stringify({ wrote: target }) + "\n");
await new Promise((resolve) => setTimeout(resolve, Number(sleepMs)));
process.stdout.write("SLEEP_COMPLETED_WITHOUT_BEING_KILLED\n");
