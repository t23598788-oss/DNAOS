#!/usr/bin/env node
/**
 * DNA OS Device Connector (2026-09-25) — the USER-MACHINE executor of the
 * SAME system (pair → heartbeat → allowlisted server→device commands).
 *
 * Rules encoded here:
 *  - ZERO npm deps; NO repo/npm/dev-server needed — only Node ≥18.
 *  - NO service-role/owner/admin secret: the device holds ONLY its own
 *    `dnad_...` token in the OS secret store (macOS Keychain / Windows DPAPI
 *    / Linux libsecret) — never a plaintext config file, never logged.
 *  - Standard OS install paths from os.homedir() — never a developer path.
 *  - Execution = argv-array spawn ONLY (allowlisted commands; no shell).
 *  - Health = hardware facts only (OS/version/arch/CPU/RAM/disk/tools);
 *    no file-content scanning, ever.
 *
 * Usage:
 *   node dnaos-device.mjs selftest
 *   node dnaos-device.mjs pair <CODE> [--server https://host]
 *   node dnaos-device.mjs run | status | install | uninstall
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVICE_TOKEN = "dnaos.device.token";
const SELFTEST_ENTRY = "dnaos.device.selftest";

// ── Standard per-OS locations (never a developer path) ─────────────────────
function configDir() {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "DNA OS");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "DNA OS");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "dna-os");
}
function configPath() { return path.join(configDir(), "connector.json"); }
function launchDir() {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "LaunchAgents");
  if (process.platform === "win32") return configDir();
  return path.join(os.homedir(), ".config", "systemd", "user");
}
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), "utf8")); } catch { return {}; }
}
function saveConfig(cfg) {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

// ── OS secret store adapters (rule4: credential อยู่ในที่เก็บของ OS) ───────
function secretStoreKind() {
  if (process.platform === "darwin") return "keychain";
  if (process.platform === "win32") return "dpapi";
  const st = spawnSync("secret-tool", ["--help"], { encoding: "utf8" });
  return st.error ? "missing" : "libsecret";
}

function tokenWrite(serviceName, token) {
  const kind = secretStoreKind();
  if (kind === "keychain") {
    const r = spawnSync("security", ["add-generic-password", "-U", "-s", serviceName, "-a", "dnaos", "-w", token], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`keychain write failed: ${(r.stderr || "").trim()}`);
    return;
  }
  if (kind === "dpapi") {
    const script = `$s = ConvertTo-SecureString '${token.replace(/'/g, "''")}' -AsPlainText -Force; ConvertFrom-SecureString $s`;
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`DPAPI write failed: ${(r.stderr || "").trim()}`);
    fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(configDir(), `${serviceName}.dpapi`), (r.stdout || "").trim(), { mode: 0o600 });
    return;
  }
  if (kind === "libsecret") {
    const r = spawnSync("secret-tool", ["store", "--label", `DNA OS ${serviceName}`, "service", serviceName, "username", "dnaos"], {
      encoding: "utf8", input: token,
    });
    if (r.status !== 0) throw new Error(`secret-tool store failed: ${(r.stderr || "").trim()}`);
    return;
  }
  throw new Error("ไม่พบที่เก็บความลับของระบบ (macOS Keychain · Windows DPAPI · Linux ต้องมี libsecret-tools) — จงใจไม่เก็บ token เป็นไฟล์เปล่า");
}
function tokenRead(serviceName) {
  const kind = secretStoreKind();
  if (kind === "keychain") {
    const r = spawnSync("security", ["find-generic-password", "-s", serviceName, "-a", "dnaos", "-w"], { encoding: "utf8" });
    return r.status === 0 ? (r.stdout || "").trim() : null;
  }
  if (kind === "dpapi") {
    try {
      const blob = fs.readFileSync(path.join(configDir(), `${serviceName}.dpapi`), "utf8").trim();
      const script = `$ss = ConvertTo-SecureString '${blob.replace(/'/g, "''")}'; [System.Net.NetworkCredential]::new('', $ss).Password`;
      const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
      return r.status === 0 ? ((r.stdout || "").trim() || null) : null;
    } catch { return null; }
  }
  if (kind === "libsecret") {
    const r = spawnSync("secret-tool", ["lookup", "service", serviceName, "username", "dnaos"], { encoding: "utf8" });
    return r.status === 0 ? ((r.stdout || "").trim() || null) : null;
  }
  return null;
}
function tokenDelete(serviceName) {
  const kind = secretStoreKind();
  if (kind === "keychain") { spawnSync("security", ["delete-generic-password", "-s", serviceName, "-a", "dnaos"]); return; }
  if (kind === "dpapi") { try { fs.unlinkSync(path.join(configDir(), `${serviceName}.dpapi`)); } catch { /* already gone */ } return; }
  if (kind === "libsecret") { spawnSync("secret-tool", ["clear", "service", serviceName, "username", "dnaos"]); return; }
}

// ── Hardware facts (rule3: OS/version/arch/RAM/disk/tools — ไม่สแกนไฟล์) ───
function existsBin(bin) {
  const probe = process.platform === "win32" ? "where" : "which";
  return spawnSync(probe, [bin], { encoding: "utf8" }).status === 0;
}
function detectTools() {
  return {
    lp: existsBin("lp"),
    lpstat: existsBin("lpstat"),
    secret_store: secretStoreKind(),
  };
}
async function healthFacts() {
  let diskFreeBytes = null;
  try {
    const s = await fs.promises.statfs(process.platform === "win32" ? "C:\\" : os.homedir());
    diskFreeBytes = Number(s.bavail) * Number(s.bsize);
  } catch { diskFreeBytes = null; }
  return {
    os: process.platform,
    osRelease: `${os.type()} ${os.release()}`,
    arch: process.arch,
    cpuCount: os.cpus().length,
    ramBytes: os.totalmem(),
    diskFreeBytes,
    nodeVersion: process.version,
    tools: detectTools(),
  };
}

// ── Allowlisted execution ONLY (argv arrays, never a shell) ────────────────
function probePrinters() {
  const r = spawnSync("lpstat", ["-e"], { encoding: "utf8", timeout: 8000 });
  if (r.error || r.status !== 0) {
    return { printers: [], error: r.error ? String(r.error.message) : (r.stderr || "").trim() || `lpstat exit ${r.status}` };
  }
  return { printers: (r.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean) };
}
const ALLOWED_COMMANDS = { probe_printers: probePrinters };

// ── HTTP (same-origin server only; token via header, never URL/query) ──────
function serverUrl(override) {
  const url = override || loadConfig().server;
  if (!url) throw new Error("ยังไม่ได้ตั้ง server — ใช้: pair <CODE> --server https://<โดเมนแอป>");
  return String(url).replace(/\/+$/, "");
}
async function postJson(url, pathName, payload, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["x-dnaos-device-token"] = token;
  const res = await fetch(`${url}${pathName}`, { method: "POST", headers, body: JSON.stringify(payload) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  return { status: res.status, json };
}

async function commandPair(args) {
  const code = args.find((a) => !a.startsWith("--"));
  const srvIdx = args.indexOf("--server");
  const server = srvIdx >= 0 ? args[srvIdx + 1] : null;
  if (!code) throw new Error("ต้องระบุโค้ดจับคู่: node dnaos-device.mjs pair <CODE> --server <url>");
  if (!secretStoreAvailable()) throw new Error("ไม่พบที่เก็บความลับของระบบ — ติดตั้ง libsecret-tools (Linux) ก่อน pair");
  const health = await healthFacts();
  const res = await postJson(serverUrl(server), "/api/internal/device/pair", { code, health });
  if (res.status !== 200 || !res.json?.ok) {
    throw new Error(`pair ไม่สำเร็จ (HTTP ${res.status}): ${res.json?.error ?? "unknown error"}${res.json?.code ? ` [${res.json.code}]` : ""}`);
  }
  tokenWrite(SERVICE_TOKEN, res.json.token); // ONE-TIME token → OS secret store
  saveConfig({ server: serverUrl(server), deviceId: res.json.device_id, pairedAt: new Date().toISOString(), grants: res.json.grants ?? [] });
  //绝不 echo the token — success message carries device id only.
  console.log(JSON.stringify({ ok: true, device_id: res.json.device_id, grants: res.json.grants ?? [], stored_in: secretStoreKind() }, null, 2));
}
function secretStoreAvailable() { return secretStoreKind() !== "missing"; }

async function commandRun(args) {
  const cfg = loadConfig();
  const token = tokenRead(SERVICE_TOKEN);
  if (!cfg.server || !token) {
    console.error("ยังไม่ได้จับคู่ — รัน: node dnaos-device.mjs pair <CODE> --server <url> (โค้ดจากหน้า /admin/devices)");
    process.exit(3);
  }
  const intervalMs = Number(args.includes("--interval") ? args[args.indexOf("--interval") + 1] : 30000) || 30000;
  const once = args.includes("--once");
  console.log(`[dnaos-device] heartbeating → ${cfg.server} (interval ${intervalMs}ms, store=${secretStoreKind()})`);
  for (;;) {
    try {
      const res = await postJson(cfg.server, "/api/internal/device/health", await healthFacts(), token);
      if (res.status === 401 || res.status === 403) {
        console.error(`[dnaos-device] server ปฏิเสธ token (${res.status}): ${res.json?.error ?? ""} — จับคู่ใหม่จากหน้า /admin/devices`);
        process.exit(4);
      }
      if (res.status === 409) {
        console.error("[dnaos-device] ฝั่งเซิร์ฟเวอร์ยังไม่มีตาราง device (รอ migration) — จะลองใหม่");
      } else if (res.json?.ok) {
        for (const cmd2 of res.json.commands ?? []) {
          const handler = ALLOWED_COMMANDS[cmd2.type];
          if (!handler) continue; // unknown → ignored (allowlist only)
          const result = handler();
          console.log(`[dnaos-device] command ${cmd2.type} → ${JSON.stringify(result).slice(0, 400)}`);
        }
      }
    } catch (e) {
      console.error(`[dnaos-device] heartbeat error: ${e.message ?? e}`);
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function commandStatus() {
  const cfg = loadConfig();
  const token = tokenRead(SERVICE_TOKEN);
  const facts = await healthFacts();
  console.log(JSON.stringify({
    paired: Boolean(cfg.server && token),
    server: cfg.server ?? null,
    device_id: cfg.deviceId ?? null,
    paired_at: cfg.pairedAt ?? null,
    grants: cfg.grants ?? [],
    secret_store: secretStoreKind(),
    health: facts,
  }, null, 2));
}

// ── Install / Uninstall — standard OS locations, paths derived at runtime ──
function connectorCopyPath() { return path.join(configDir(), "dnaos-device.mjs"); }
function unitPaths() {
  // Install ALWAYS registers the copy in the standard OS location — never the
  // path this script happens to run from (repo/dev checkout on a dev box,
  // download folder on a user's machine).
  const self = connectorCopyPath();
  const node = process.execPath;
  if (process.platform === "darwin") {
    const plist = path.join(launchDir(), "com.dnaos.device-connector.plist");
    const log = path.join(configDir(), "connector.log");
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.dnaos.device-connector</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${self}</string><string>run</string></array>
  <key>WorkingDirectory</key><string>${configDir()}</string>
  <key>StartInterval</key><integer>30</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`;
    return { kind: "launchd", file: plist, content };
  }
  if (process.platform === "win32") {
    return { kind: "schtasks", args: ["/Create", "/F", "/TN", "DNA OS Device Connector", "/TR", `"${node}" "${self}" run`, "/SC", "ONLOGON"] };
  }
  const unit = path.join(launchDir(), "dnaos-device-connector.service");
  const content = `[Unit]
Description=DNA OS Device Connector
After=network-online.target

[Service]
ExecStart=${node} ${self} run
WorkingDirectory=${configDir()}
Restart=on-failure

[Install]
WantedBy=default.target
`;
  return { kind: "systemd-user", file: unit, content };
}
function commandInstall() {
  if (!loadConfig().server) throw new Error("ยังไม่ได้จับคู่ — pair ก่อนติดตั้ง service");
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  // Copy the connector into the standard OS location first (self-contained —
  // the registered service never points back at a repo/checkout/download dir).
  const src = fs.realpathSync(process.argv[1]);
  const dest = connectorCopyPath();
  if (src !== dest) fs.copyFileSync(src, dest);
  fs.chmodSync(dest, 0o755);
  const u = unitPaths();
  if (u.kind === "launchd") {
    fs.mkdirSync(launchDir(), { recursive: true });
    fs.writeFileSync(u.file, u.content);
    const r = spawnSync("launchctl", ["load", "-w", u.file], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`launchctl load failed: ${(r.stderr || "").trim()}`);
    console.log(JSON.stringify({ ok: true, kind: u.kind, unit: u.file }));
    return;
  }
  if (u.kind === "schtasks") {
    const r = spawnSync("schtasks", u.args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`schtasks failed: ${(r.stderr || "").trim()}`);
    console.log(JSON.stringify({ ok: true, kind: u.kind, task: "DNA OS Device Connector" }));
    return;
  }
  fs.mkdirSync(launchDir(), { recursive: true });
  fs.writeFileSync(u.file, u.content, { mode: 0o644 });
  spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8" });
  const r = spawnSync("systemctl", ["--user", "enable", "--now", "dnaos-device-connector.service"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`systemctl enable failed: ${(r.stderr || "").trim()}`);
  console.log(JSON.stringify({ ok: true, kind: u.kind, unit: u.file }));
}
function commandUninstall() {
  if (process.platform === "darwin") {
    const file = path.join(launchDir(), "com.dnaos.device-connector.plist");
    spawnSync("launchctl", ["unload", "-w", file], { encoding: "utf8" });
    try { fs.unlinkSync(file); } catch { /* already gone */ }
  } else if (process.platform === "win32") {
    spawnSync("schtasks", ["/Delete", "/F", "/TN", "DNA OS Device Connector"], { encoding: "utf8" });
  } else {
    spawnSync("systemctl", ["--user", "disable", "--now", "dnaos-device-connector.service"], { encoding: "utf8" });
    try { fs.unlinkSync(path.join(launchDir(), "dnaos-device-connector.service")); } catch { /* already gone */ }
    spawnSync("systemctl", ["--user", "daemon-reload"], { encoding: "utf8" });
  }
  tokenDelete(SERVICE_TOKEN);
  try { fs.unlinkSync(path.join(configDir(), "connector.log")); } catch { /* already gone */ }
  try { fs.unlinkSync(connectorCopyPath()); } catch { /* already gone */ }
  try { fs.unlinkSync(configPath()); } catch { /* already gone */ }
  console.log(JSON.stringify({ ok: true, removed: ["service", "token", "config", "connector-copy", "log"], note: "เพิกถอนฝั่งเซิร์ฟเวอร์: กด Revoke ที่หน้า /admin/devices" }));
}

async function commandSelftest() {
  const facts = await healthFacts();
  let keychainRoundtrip = "skipped";
  try {
    tokenWrite(SELFTEST_ENTRY, `st_${Math.random().toString(36).slice(2)}`);
    const back = tokenRead(SELFTEST_ENTRY);
    tokenDelete(SELFTEST_ENTRY);
    keychainRoundtrip = back ? "ok" : "read_failed";
  } catch (e) {
    keychainRoundtrip = `error: ${e.message}`;
  }
  console.log(JSON.stringify({
    ok: keychainRoundtrip === "ok",
    platform: process.platform,
    ...facts,
    config_dir: configDir(),
    launch_dir: launchDir(),
    keychain_roundtrip: keychainRoundtrip,
    paired: Boolean(loadConfig().server && tokenRead(SERVICE_TOKEN)),
  }, null, 2));
  if (keychainRoundtrip !== "ok") process.exit(1);
}

// ── main ───────────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  selftest: commandSelftest,
  pair: commandPair,
  run: commandRun,
  status: commandStatus,
  install: commandInstall,
  uninstall: commandUninstall,
};
const chosen = commands[cmd];
if (!chosen) {
  console.error("ใช้: node dnaos-device.mjs <selftest|pair|run|status|install|uninstall>");
  process.exit(1);
}
// Promise.resolve — status/install/uninstall are sync (return undefined);
// only pair/run return promises. `.catch` on undefined was a real bug caught
// by the install/uninstall round-trip test on macOS (2026-09-25).
Promise.resolve()
  .then(() => chosen(rest))
  .catch((e) => {
    console.error(e.message ?? String(e));
    process.exit(1);
  });

export { healthFacts, probePrinters, detectTools, secretStoreKind, configDir, launchDir, tokenWrite, tokenRead, tokenDelete, ALLOWED_COMMANDS, unitPaths };



