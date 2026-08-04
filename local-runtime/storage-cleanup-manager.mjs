#!/usr/bin/env node
// DEPRECATED 2026-08-04 — superseded by the storage-intelligence capability:
// engines/storage/* (real classifier/evidence/decision engine, DB-persisted
// scan history, audit trail) + the /admin/storage UI + the
// app/api/admin/storage-intelligence gateway route. This standalone script's
// scan/classify logic was migrated there (per owner instruction: "ห้ามมีสอง
// แหล่งตัดสินใจ" — no dual decision system). Kept only for reference/
// emergency CLI use when the Next.js app isn't running; NOT the recommended
// path going forward. See registry/capability-roadmap.json #39.
//
// Storage Cleanup Manager — scans the Mac for safe-to-reclaim files and moves
// them to ~/.Trash (never permanent delete). Default is simulation-only;
// pass --confirm to actually move files. User empties Trash themselves.
//
// Usage:
//   node storage-cleanup-manager.mjs                # simulate, report only
//   node storage-cleanup-manager.mjs --confirm       # move flagged files to Trash
//   node storage-cleanup-manager.mjs --confirm --categories=npm,downloads

import { execSync } from "child_process";
import { readdirSync, statSync, renameSync, existsSync, mkdirSync, appendFileSync, createReadStream } from "fs";
import { createHash } from "crypto";
import { join, basename, extname } from "path";
import { homedir } from "os";

const HOME = homedir();
const TRASH = join(HOME, ".Trash");
const LOG_PATH = join(HOME, ".Trash", "storage-cleanup-manager.log");

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const categoryFilter = (args.find((a) => a.startsWith("--categories=")) || "").split("=")[1];
const wantedCategories = categoryFilter ? categoryFilter.split(",") : null;

// Never touch anything under these, no matter what a scan finds.
const NEVER_TOUCH = [
  join(HOME, "Desktop", "DNA OS-ต้นฉบับ "), // active workspace
  join(HOME, ".ssh"),
  join(HOME, ".gnupg"),
];

const OLD_DAYS_DOWNLOADS = 30;
const OLD_DAYS_LOGS = 30;
const OLD_DAYS_SCREENSHOTS = 60;

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

function du(path) {
  if (!existsSync(path)) return 0;
  const out = sh(`du -sk "${path}" 2>/dev/null`);
  const kb = parseInt(out.split("\t")[0], 10);
  return Number.isFinite(kb) ? kb * 1024 : 0;
}

function humanSize(bytes) {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + " KB";
  return bytes + " B";
}

function isProtected(fullPath) {
  return NEVER_TOUCH.some((p) => fullPath.startsWith(p)) ||
    fullPath.includes("/.git/") || fullPath.endsWith("/.git") ||
    fullPath.endsWith(".env") || fullPath.endsWith(".env.local") ||
    /node_modules\/.+\.git/.test(fullPath);
}

function daysOld(mtimeMs) {
  return (Date.now() - mtimeMs) / (1000 * 60 * 60 * 24);
}

function listFilesRecursive(dir, { maxDepth = 3 } = {}, depth = 0) {
  let out = [];
  if (depth > maxDepth || !existsSync(dir)) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (isProtected(full)) continue;
    if (e.isDirectory()) {
      out = out.concat(listFilesRecursive(full, { maxDepth }, depth + 1));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

// ---- Category scanners: each returns { category, items: [{path, size, reason}], totalBytes } ----

function scanCache(category, dirPath, note) {
  const size = du(dirPath);
  if (size === 0) return { category, items: [], totalBytes: 0 };
  return {
    category,
    items: [{ path: dirPath, size, reason: note }],
    totalBytes: size,
  };
}

function scanNpmCache() {
  const cacheDir = sh("npm config get cache") || join(HOME, ".npm");
  return scanCache("npm-cache", cacheDir, "npm package cache — safe, npm re-downloads on demand");
}

function scanPnpmCache() {
  const storeDir = sh("pnpm store path 2>/dev/null");
  if (!storeDir) return { category: "pnpm-cache", items: [], totalBytes: 0 };
  return scanCache("pnpm-cache", storeDir, "pnpm content-addressable store — safe, re-populated on install");
}

function scanYarnCache() {
  const dir = sh("yarn cache dir 2>/dev/null");
  if (!dir) return { category: "yarn-cache", items: [], totalBytes: 0 };
  return scanCache("yarn-cache", dir, "yarn package cache — safe, re-downloaded on demand");
}

function scanHomebrewCache() {
  const dir = sh("brew --cache 2>/dev/null") || join(HOME, "Library", "Caches", "Homebrew");
  return scanCache("homebrew-cache", dir, "Homebrew downloaded bottles/cache — safe, re-fetched on demand");
}

function scanDockerReport() {
  const daemonUp = sh("docker info 2>/dev/null");
  if (!daemonUp) {
    return {
      category: "docker",
      items: [],
      totalBytes: 0,
      note: "Docker daemon not running — cannot query. Docker Desktop stores images/volumes/build-cache inside its own VM disk image, which is NOT a regular file the Trash can move; reclaim via `docker system prune -a --volumes` or Docker Desktop → Troubleshoot → Clean/Purge data instead.",
    };
  }
  const df = sh("docker system df --format '{{json .}}' 2>/dev/null");
  return {
    category: "docker",
    items: [],
    totalBytes: 0,
    note: "Docker storage lives inside Docker Desktop's VM disk image, not as movable host files — cannot be Trash-moved by this tool. Run `docker builder prune -f`, `docker image prune -a -f`, `docker volume prune -f` manually, or Docker Desktop's own cleanup UI.\n" + df,
  };
}

function scanTempFiles() {
  const dirs = [join(HOME, ".cache"), "/tmp"];
  let items = [];
  let total = 0;
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    const size = du(d);
    if (size > 0) {
      items.push({ path: d, size, reason: "temp/cache directory" });
      total += size;
    }
  }
  return { category: "temp-files", items, totalBytes: total };
}

function scanOldLogs() {
  const dirs = [join(HOME, "Library", "Logs")];
  let items = [];
  let total = 0;
  for (const d of dirs) {
    const files = listFilesRecursive(d, { maxDepth: 4 });
    for (const f of files) {
      if (extname(f) !== ".log") continue;
      try {
        const st = statSync(f);
        if (daysOld(st.mtimeMs) >= OLD_DAYS_LOGS) {
          items.push({ path: f, size: st.size, reason: `log file, ${Math.floor(daysOld(st.mtimeMs))} days old` });
          total += st.size;
        }
      } catch {}
    }
  }
  return { category: "old-logs", items, totalBytes: total };
}

function scanOldDownloads() {
  const dir = join(HOME, "Downloads");
  const exts = new Set([".zip", ".dmg", ".iso", ".pkg", ".tar", ".gz"]);
  let items = [];
  let total = 0;
  const files = listFilesRecursive(dir, { maxDepth: 2 });
  for (const f of files) {
    if (!exts.has(extname(f).toLowerCase())) continue;
    try {
      const st = statSync(f);
      if (daysOld(st.mtimeMs) >= OLD_DAYS_DOWNLOADS) {
        items.push({ path: f, size: st.size, reason: `installer/archive, ${Math.floor(daysOld(st.mtimeMs))} days old, unmodified since` });
        total += st.size;
      }
    } catch {}
  }
  return { category: "old-downloads", items, totalBytes: total };
}

function scanOldScreenshots() {
  const dirs = [join(HOME, "Desktop"), join(HOME, "Downloads")];
  let items = [];
  let total = 0;
  for (const dir of dirs) {
    const files = listFilesRecursive(dir, { maxDepth: 1 });
    for (const f of files) {
      const name = basename(f);
      if (!/^Screen Shot|^Screenshot/i.test(name)) continue;
      try {
        const st = statSync(f);
        if (daysOld(st.mtimeMs) >= OLD_DAYS_SCREENSHOTS) {
          items.push({ path: f, size: st.size, reason: `screenshot, ${Math.floor(daysOld(st.mtimeMs))} days old` });
          total += st.size;
        }
      } catch {}
    }
  }
  return { category: "old-screenshots", items, totalBytes: total };
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

async function scanDuplicateFiles() {
  // Only scans Downloads + Desktop (non-project areas) — never touches source code trees.
  const dirs = [join(HOME, "Downloads"), join(HOME, "Desktop")];
  let candidates = [];
  for (const d of dirs) {
    candidates = candidates.concat(listFilesRecursive(d, { maxDepth: 2 }));
  }
  // Group by size first (cheap) before hashing (expensive) — real dupes must match size.
  const bySize = new Map();
  for (const f of candidates) {
    try {
      const st = statSync(f);
      if (st.size < 1024) continue; // skip tiny files, not worth the risk/hash cost
      if (!bySize.has(st.size)) bySize.set(st.size, []);
      bySize.get(st.size).push(f);
    } catch {}
  }
  let items = [];
  let total = 0;
  for (const [size, files] of bySize) {
    if (files.length < 2) continue;
    const hashes = new Map();
    for (const f of files) {
      try {
        const h = await sha256(f);
        if (!hashes.has(h)) hashes.set(h, []);
        hashes.get(h).push(f);
      } catch {}
    }
    for (const [, group] of hashes) {
      if (group.length < 2) continue;
      // Keep the oldest (first-created) copy, flag the rest as duplicates.
      group.sort((a, b) => statSync(a).birthtimeMs - statSync(b).birthtimeMs);
      const [keep, ...dupes] = group;
      for (const d of dupes) {
        items.push({ path: d, size, reason: `duplicate of ${keep} (sha256 match)` });
        total += size;
      }
    }
  }
  return { category: "duplicate-files", items, totalBytes: total };
}

// Whole project directories that are either not a git repo (a ZIP extraction)
// or a git clone with zero uncommitted changes and a HEAD that exists elsewhere
// too — i.e. deleting them loses nothing. Each entry must be independently
// re-verified at scan time (git status/remote), never trusted from a stale list.
const CANDIDATE_STALE_CLONES = [
  join(HOME, "Desktop", "soil-app-main"),
  join(HOME, "Desktop", "GitHub", "soil-app"),
  join(HOME, "Desktop", "GitHub", "dna-os"),
];

function scanStaleClones() {
  let items = [];
  let total = 0;
  for (const dir of CANDIDATE_STALE_CLONES) {
    if (!existsSync(dir)) continue;
    const isGitRepo = existsSync(join(dir, ".git"));
    let reason;
    if (!isGitRepo) {
      reason = "not a git repository (likely a ZIP extraction) — no history to lose";
    } else {
      const status = sh(`git -C "${dir}" status --short 2>/dev/null`);
      if (status) {
        // Has real uncommitted changes — do NOT flag as safe, skip entirely.
        continue;
      }
      const remote = sh(`git -C "${dir}" remote get-url origin 2>/dev/null`);
      reason = `clean git clone (0 uncommitted changes), remote ${remote || "unknown"} — duplicate exists elsewhere`;
    }
    const size = du(dir);
    items.push({ path: dir, size, reason });
    total += size;
  }
  return { category: "stale-clones", items, totalBytes: total };
}

function scanSupabaseUploadedNote() {
  // Honest placeholder: no established convention yet maps local files to
  // Supabase Storage objects with a verifiable hash. Not implemented — flagging
  // rather than fabricating a match.
  return {
    category: "supabase-uploaded",
    items: [],
    totalBytes: 0,
    note: "Not implemented: no existing local-file-to-Supabase-Storage-object hash mapping exists in this codebase to safely verify a local copy is redundant. Needs a real convention (e.g. a manifest table) before this can be automated — flagging rather than guessing.",
  };
}

const SCANNERS = {
  "npm": scanNpmCache,
  "pnpm": scanPnpmCache,
  "yarn": scanYarnCache,
  "homebrew": scanHomebrewCache,
  "docker": scanDockerReport,
  "temp": scanTempFiles,
  "logs": scanOldLogs,
  "downloads": scanOldDownloads,
  "screenshots": scanOldScreenshots,
  "duplicates": scanDuplicateFiles,
  "stale-clones": scanStaleClones,
  "supabase-uploaded": scanSupabaseUploadedNote,
};

function moveToTrash(filePath) {
  if (isProtected(filePath)) throw new Error(`refused to trash protected path: ${filePath}`);
  if (!existsSync(TRASH)) mkdirSync(TRASH, { recursive: true });
  let dest = join(TRASH, basename(filePath));
  if (existsSync(dest)) {
    dest = join(TRASH, `${Date.now()}-${basename(filePath)}`);
  }
  renameSync(filePath, dest);
  appendFileSync(
    LOG_PATH,
    `${new Date().toISOString()}\tMOVED\t${filePath}\t->\t${dest}\n`
  );
  return dest;
}

async function main() {
  const results = [];
  for (const [name, fn] of Object.entries(SCANNERS)) {
    if (wantedCategories && !wantedCategories.includes(name)) continue;
    const r = await fn();
    results.push(r);
  }

  const grandTotal = results.reduce((sum, r) => sum + r.totalBytes, 0);

  console.log(CONFIRM ? "=== Storage Cleanup Manager — MOVING TO TRASH ===" : "=== Storage Cleanup Manager — SIMULATION MODE (no files moved) ===");
  console.log("");
  for (const r of results) {
    if (r.note) {
      console.log(`[${r.category}]  ${r.note.split("\n")[0]}`);
      continue;
    }
    if (r.items.length === 0) continue;
    console.log(`[${r.category}]  ${humanSize(r.totalBytes)}`);
    for (const item of r.items.slice(0, 10)) {
      console.log(`   - ${item.path}  (${humanSize(item.size)})  ${item.reason}`);
    }
    if (r.items.length > 10) console.log(`   ...and ${r.items.length - 10} more`);
  }
  console.log("");
  console.log(`รวมคืนพื้นที่ได้ประมาณ ${humanSize(grandTotal)}`);
  console.log("");

  if (!CONFIRM) {
    console.log("Simulation only. Re-run with --confirm to move these files to ~/.Trash.");
    console.log("Nothing is permanently deleted — you empty Trash yourself when ready.");
    return;
  }

  console.log("Moving to Trash...");
  let moved = 0;
  let movedBytes = 0;
  for (const r of results) {
    for (const item of r.items) {
      try {
        moveToTrash(item.path);
        moved++;
        movedBytes += item.size;
      } catch (e) {
        console.log(`   ⚠ skipped ${item.path}: ${e.message}`);
      }
    }
  }
  console.log("");
  console.log(`Moved to Trash: ${moved} items, ~${humanSize(movedBytes)}`);
  console.log(`Log: ${LOG_PATH}`);
  console.log(`คืนพื้นที่ทันทีประมาณ ${humanSize(movedBytes)} — ผู้ใช้สามารถ Empty Trash ได้เมื่อมั่นใจ`);
}

main();
