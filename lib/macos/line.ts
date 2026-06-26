/**
 * Node.js Wrapper สำหรับ LINE Desktop Controller (Swift)
 *
 * await line.status()
 * await line.launch()
 * await line.readLast()
 * await line.send("ทดสอบ")
 * await line.openChat("ลูกค้า A")
 */

import { execFile } from "child_process";
import { join } from "path";

const BINARY = join(__dirname, "line-ctrl");

interface LineResult {
  success: boolean;
  command: string;
  [key: string]: unknown;
}

async function exec(command: string, args: Record<string, string> = {}): Promise<LineResult> {
  const cliArgs = [command];
  for (const [k, v] of Object.entries(args)) {
    cliArgs.push(`--${k}`, v);
  }

  return new Promise((resolve) => {
    execFile(BINARY, cliArgs, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ success: false, command, error: stderr?.trim() || err.message });
        return;
      }
      try {
        const json = JSON.parse(stdout);
        resolve({ success: json.ok ?? false, command, ...json });
      } catch {
        resolve({ success: false, command, error: "Invalid JSON", raw: stdout });
      }
    });
  });
}

// ── Public API ──

export async function status() { return exec("status"); }
export async function launch() { return exec("launch"); }
export async function focus() { return exec("focus"); }
export async function quit() { return exec("quit"); }

export async function readMessages() { return exec("read"); }
export async function readLast() { return exec("read.last"); }
export async function readChatList() { return exec("read.chatlist"); }

export async function send(text: string) { return exec("send", { text }); }
export async function openChat(name: string) { return exec("open_chat", { name }); }
export async function search(query: string) { return exec("search", { query }); }
export async function back() { return exec("back"); }

export async function snapshot() { return exec("snapshot"); }
export async function permissions() { return exec("permissions"); }

export async function inspect(depth = 6) { return exec("inspect", { depth: String(depth) }); }
export async function inspectKeys() { return exec("inspect.keys"); }
export async function resolve(name: string) { return exec("resolve", { name }); }

export async function windowResize(x: number, y: number, w: number, h: number) {
  return exec("window.resize", { x: String(x), y: String(y), w: String(w), h: String(h) });
}

// Default export
const line = {
  status, launch, focus, quit,
  readMessages, readLast, readChatList,
  send, openChat, search, back,
  snapshot, permissions,
  inspect, inspectKeys, resolve, windowResize,
};

export default line;
