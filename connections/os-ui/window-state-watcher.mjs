import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const root = process.cwd();
const dataDir = path.join(root, "connections/os-ui/data");
const statePath = path.join(dataDir, "window-state.jsonl");
const patternPath = path.join(dataDir, "behavior-patterns.json");
fs.mkdirSync(dataDir, { recursive: true });

function readWindowState() {
  return new Promise((resolve) => {
    const script = 'tell application "System Events" to set p to first process whose frontmost is true\n' +
      'tell application "System Events" to return (name of p) & "|" & (name of front window of p)';
    execFile("/usr/bin/osascript", ["-e", script], { timeout: 5000 }, (error, stdout) => {
      if (error) return resolve({ state: "read_error", error: "ACCESSIBILITY_UNAVAILABLE" });
      const [app = "", title = ""] = stdout.trim().split("|");
      resolve({ state: "window_active", app, title });
    });
  });
}

let last = "";
function updatePatterns() {
  const actionCounts = {};
  const statusCounts = {};
  try {
    const auditPath = path.join(dataDir, "work-order-audit.jsonl");
    for (const line of fs.readFileSync(auditPath, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        const action = row.order?.ui_action;
        const status = row.outcome?.status;
        if (action) actionCounts[action] = (actionCounts[action] ?? 0) + 1;
        if (status) statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      } catch {}
    }
  } catch {}
  const windows = [];
  try {
    for (const line of fs.readFileSync(statePath, "utf8").split("\n").slice(-100)) {
      if (!line.trim()) continue;
      try { const row = JSON.parse(line); windows.push({ app: row.app ?? "", title: row.title ?? "", state: row.state }); } catch {}
    }
  } catch {}
  const transitions = windows.slice(1).filter((row, i) => JSON.stringify(row) !== JSON.stringify(windows[i])).length;
  fs.writeFileSync(patternPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: ["work-order-audit.jsonl", "window-state.jsonl"],
    action_counts: actionCounts,
    status_counts: statusCounts,
    recent_window_observations: windows.slice(-20),
    recent_window_transitions: transitions,
    learning_mode: "OBSERVE_ONLY",
    policy_mutation: "DISABLED",
  }, null, 2) + "\n", "utf8");
}

async function sample() {
  const observedAt = new Date().toISOString();
  const observation = await readWindowState();
  const record = { observed_at: observedAt, source: "os-ui.window-state-watcher", ...observation };
  const fingerprint = JSON.stringify(record);
  if (fingerprint !== last) {
    fs.appendFileSync(statePath, `${JSON.stringify(record)}\n`, "utf8");
    last = fingerprint;
  }
  updatePatterns();
}

await sample();
setInterval(() => void sample(), 5000);
