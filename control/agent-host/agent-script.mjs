#!/usr/bin/env node
// The simulated "Agent" process for Phase 9's proof. Receives one JSON
// instruction as argv[2] and attempts exactly the action it names — for
// real, against the real filesystem/process table it is actually given.
// Never simulates a result: every field below reflects what really
// happened (a real fs call, a real spawn attempt), reported honestly
// whether it succeeded or was denied. Prints one JSON line to stdout.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const instruction = JSON.parse(process.argv[2] ?? "{}");
const result = { action: instruction.action, cwd: process.cwd(), env_keys: Object.keys(process.env).sort() };

function tryExec(label, bin, args) {
  return new Promise((resolve) => {
    try {
      const child = spawn(bin, args, { stdio: ["ignore", "ignore", "ignore"] });
      child.on("error", (err) => resolve({ label, attempted: true, blocked: true, mechanism: `spawn error: ${err.code ?? err.message}` }));
      child.on("exit", (code) => resolve({ label, attempted: true, blocked: false, exit_code: code }));
    } catch (err) {
      resolve({ label, attempted: true, blocked: true, mechanism: `throw: ${err.code ?? err.message}` });
    }
  });
}

async function run() {
  switch (instruction.action) {
    case "read_allowed": {
      const p = path.join(process.cwd(), instruction.relPath);
      try {
        result.content = fs.readFileSync(p, "utf-8");
        result.outcome = "SUCCEEDED";
      } catch (err) {
        result.outcome = "FAILED";
        result.error = { code: err.code, message: err.message };
      }
      break;
    }
    case "read_outside": {
      try {
        result.content = fs.readFileSync(instruction.absPath, "utf-8");
        result.outcome = "SUCCEEDED";
      } catch (err) {
        result.outcome = "BLOCKED";
        result.error = { code: err.code, message: err.message };
      }
      break;
    }
    case "write_direct_outside": {
      try {
        fs.writeFileSync(instruction.absPath, instruction.content ?? "agent-wrote-this-directly");
        result.outcome = "SUCCEEDED";
      } catch (err) {
        result.outcome = "BLOCKED";
        result.error = { code: err.code, message: err.message };
      }
      break;
    }
    case "write_direct_allowed_attempt": {
      // Proves the Agent CAN physically touch disk inside its own cwd (no gate here by design —
      // the point of the proof is that AUTHORIZED writes go through Write Gate + Executor instead
      // of the Agent ever using this path for anything the harness treats as "the real result").
      try {
        fs.writeFileSync(path.join(process.cwd(), instruction.relPath), instruction.content ?? "agent-direct-write");
        result.outcome = "SUCCEEDED";
      } catch (err) {
        result.outcome = "BLOCKED";
        result.error = { code: err.code, message: err.message };
      }
      break;
    }
    case "propose_authorized_write": {
      // PROPOSAL ONLY (Owner, CONNECT_AGENT_REQUESTED_ACTION_TO_EXISTING_WRITE_AUTHORITY_PIPE).
      // The Agent writes the proposed content into its OWN workspace (process.cwd() is the
      // one directory the sandbox profile grants file-write* on) and never touches
      // instruction.target_path. What it returns is DATA — a RequestedAction — never authority.
      // DNA OS re-resolves artifact_ref against the workspace boundary before reading it.
      try {
        const artifactPath = path.join(process.cwd(), instruction.artifact_rel_path);
        fs.writeFileSync(artifactPath, instruction.content ?? "");
        result.outcome = "WRITE_PROPOSAL_EMITTED";
        result.artifact_path = artifactPath;
        result.requested_actions = [{
          operation: instruction.operation ?? "FILE_MODIFY",
          artifact_ref: `artifact://${artifactPath}`,
          target: instruction.target_path,
        }];
      } catch (err) {
        result.outcome = "BLOCKED";
        result.error = { code: err.code, message: err.message };
      }
      break;
    }
    case "request_authorized_write": {
      // The Agent does NOT write itself — it emits a structured WRITE_REQUEST for DNA OS
      // (the parent, ./tests/proof.test.ts) to evaluate through the real Write Gate + File Executor.
      result.outcome = "WRITE_REQUEST_EMITTED";
      result.write_request = { target_path: instruction.target_path, content: instruction.content };
      break;
    }
    case "exec_git":
      result.exec = await tryExec("git", instruction.bin, ["--version"]);
      result.outcome = result.exec.blocked ? "BLOCKED" : "SUCCEEDED";
      break;
    case "exec_gh":
      result.exec = await tryExec("gh", instruction.bin, ["auth", "status"]);
      result.outcome = result.exec.blocked ? "BLOCKED" : "SUCCEEDED";
      break;
    case "exec_vercel":
      result.exec = await tryExec("vercel", instruction.bin, instruction.args ?? ["--version"]);
      result.outcome = result.exec.blocked ? "BLOCKED" : "SUCCEEDED";
      break;
    case "exec_supabase":
      result.exec = await tryExec("supabase", instruction.bin, ["--version"]);
      result.outcome = result.exec.blocked ? "BLOCKED" : "SUCCEEDED";
      break;
    case "exec_security":
      result.exec = await tryExec("security", instruction.bin ?? "/usr/bin/security", ["find-generic-password", "-s", "Supabase CLI"]);
      result.outcome = result.exec.blocked ? "BLOCKED" : "SUCCEEDED";
      break;
    case "exec_npm_install":
      result.exec = await tryExec("npm_install", instruction.bin ?? "/usr/bin/env", ["npm", "install", instruction.pkg ?? "left-pad"]);
      result.outcome = result.exec.blocked ? "BLOCKED" : "SUCCEEDED";
      break;
    case "exec_npx":
      result.exec = await tryExec("npx", instruction.bin ?? "/usr/bin/env", ["npx", "--yes", instruction.pkg ?? "cowsay", "hi"]);
      result.outcome = result.exec.blocked ? "BLOCKED" : "SUCCEEDED";
      break;
    case "exec_osascript":
      result.exec = await tryExec("osascript", instruction.bin ?? "/usr/bin/osascript", ["-e", 'tell application "Finder" to activate']);
      result.outcome = result.exec.blocked ? "BLOCKED" : "SUCCEEDED";
      break;
    case "write_real_source_attempt": {
      // Attempts a write to a REAL path inside the actual repository source tree
      // (never inside allowedWorkspaceDir) -- distinct from TEST3's generic
      // "outside" probe dir, this names an actual source-tree file directly.
      try {
        fs.writeFileSync(instruction.absPath, instruction.content ?? "agent-wrote-into-real-source");
        result.outcome = "SUCCEEDED";
      } catch (err) {
        result.outcome = "BLOCKED";
        result.error = { code: err.code, message: err.message };
      }
      break;
    }
    case "attempt_network": {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(instruction.url ?? "https://api.github.com", { signal: controller.signal });
        clearTimeout(timer);
        result.outcome = "SUCCEEDED";
        result.http_status = res.status;
      } catch (err) {
        result.outcome = "BLOCKED";
        result.error = { code: err.code ?? err.name, message: err.message };
      }
      break;
    }
    case "credential_probe": {
      const names = ["GITHUB_TOKEN", "GH_TOKEN", "VERCEL_TOKEN", "VERCEL_ORG_ID", "SUPABASE_ACCESS_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY"];
      result.credential_env_visible = Object.fromEntries(names.map((n) => [n, Object.prototype.hasOwnProperty.call(process.env, n)]));
      result.outcome = "REPORTED";
      break;
    }
    default:
      result.outcome = "UNKNOWN_ACTION";
  }
  process.stdout.write(JSON.stringify(result));
}

run();
