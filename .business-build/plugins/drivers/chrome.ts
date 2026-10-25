import { BaseDriver, ok, fail } from "./base";
import { osascript, esc } from "@/plugins/runtime/shell";
const A = "Google Chrome";

export default new (class extends BaseDriver {
  appName = A; bundleId = "com.google.Chrome";
  constructor() { super(A); }
  async search(q: string) { const s=Date.now(); await osascript(`tell application "${A}" to open location "https://www.google.com/search?q=${encodeURIComponent(q)}"`); return ok("search",A,s,{q}); }
  async click(t: string)  { const s=Date.now(); if(t.startsWith("url:")) await osascript(`tell application "${A}" to open location "${esc(t.slice(4))}"`); else if(t.startsWith("shortcut:")) await osascript(`tell application "System Events" to keystroke "${esc(t.slice(9))}" using command down`); return ok("click",A,s,{t}); }
  async type(t: string)   { const s=Date.now(); await osascript(`tell application "System Events" to keystroke "${esc(t)}"`); return ok("type",A,s); }
  async read()             { const s=Date.now(); try { const u=await osascript(`tell application "${A}" to return URL of active tab of window 1`); return ok("read",A,s,{url:u}); } catch(e) { return fail("read",A,s,(e as Error).message); } }
})();
