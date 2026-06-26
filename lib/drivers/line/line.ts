/**
 * LINE Driver — Node.js interface
 * DNA OS ติดต่อ LINE ผ่านไฟล์นี้ตัวเดียว
 */

import { execFile } from "child_process";
import { join } from "path";

const BIN = join(__dirname, "line-driver");

interface R { success: boolean; command: string; [k: string]: unknown }

function call(cmd: string, args: Record<string, string> = {}): Promise<R> {
  const a = [cmd];
  for (const [k, v] of Object.entries(args)) a.push(`--${k}`, v);
  return new Promise(res => {
    execFile(BIN, a, { timeout: 15000 }, (err, out, se) => {
      if (err) return res({ success: false, command: cmd, error: se?.trim() || err.message });
      try { res(JSON.parse(out)); } catch { res({ success: false, command: cmd, error: "bad json" }); }
    });
  });
}

const line = {
  connect:      ()                                => call("connect"),
  status:       ()                                => call("status"),
  focus:        ()                                => call("focus"),
  listChats:    ()                                => call("listChats"),
  openChat:     (id: string)                      => call("openChat", { id }),
  currentChat:  ()                                => call("currentChat"),
  readMessages: (limit = 0)                       => call("readMessages", { limit: String(limit) }),
  readUnread:   ()                                => call("readUnread"),
  send:         (text: string)                    => call("send", { text }),
  reply:        (messageId: string, text: string) => call("reply", { messageId, text }),
  search:       (keyword: string)                 => call("search", { keyword }),
  back:         ()                                => call("back"),
  close:        ()                                => call("close"),
};

export default line;
