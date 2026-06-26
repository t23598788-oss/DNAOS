/**
 * LINE Driver — Node.js interface
 * DNA OS ติดต่อ LINE ผ่าน Driver ตัวเดียว
 * ห้าม Node.js แตะ Accessibility โดยตรง
 */

import { execFile } from "child_process";
import { join } from "path";

const BIN = join(__dirname, "line-ctrl");

interface DriverResult {
  success: boolean;
  command: string;
  timestamp?: string;
  [key: string]: unknown;
}

function call(cmd: string, args: Record<string, string> = {}): Promise<DriverResult> {
  const a = [cmd];
  for (const [k, v] of Object.entries(args)) a.push(`--${k}`, v);

  return new Promise((resolve) => {
    execFile(BIN, a, { timeout: 15000 }, (err, out, stderr) => {
      if (err) return resolve({ success: false, command: cmd, error: stderr?.trim() || err.message });
      try { const j = JSON.parse(out); resolve(j); }
      catch { resolve({ success: false, command: cmd, error: "invalid json", raw: out }); }
    });
  });
}

const line = {
  connect:      ()                          => call("connect"),
  status:       ()                          => call("status"),
  focus:        ()                          => call("focus"),
  listChats:    ()                          => call("listChats"),
  openChat:     (id: string)                => call("openChat", { id }),
  currentChat:  ()                          => call("currentChat"),
  readMessages: (limit = 0)                 => call("readMessages", { limit: String(limit) }),
  readUnread:   ()                          => call("readUnread"),
  send:         (text: string)              => call("send", { text }),
  reply:        (messageId: string, text: string) => call("reply", { messageId, text }),
  search:       (keyword: string)           => call("search", { keyword }),
  back:         ()                          => call("back"),
  close:        ()                          => call("close"),
};

export default line;
