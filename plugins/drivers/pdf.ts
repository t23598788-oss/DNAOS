import { BaseDriver, ok } from "./base";
import { osascript, esc } from "@/plugins/runtime/shell";
const A = "PDF Viewer", P = "Preview";

export default new (class extends BaseDriver {
  appName = A; bundleId = "com.apple.Preview";
  constructor() { super(P); }
  async search(q: string) { const s=Date.now(); if(q.includes("/")) await osascript(`tell application "${P}" to open POSIX file "${esc(q)}"`); else { await osascript(`tell application "System Events" to keystroke "f" using command down`); await d(300); await osascript(`tell application "System Events" to keystroke "${esc(q)}"`); } return ok("search",A,s,{q}); }
  async click(t: string)  { const s=Date.now(); if(t==="print") await osascript(`tell application "System Events" to keystroke "p" using command down`); else if(t==="export") await osascript(`tell application "System Events" to keystroke "e" using command down`); return ok("click",A,s,{t}); }
  async type(t: string)   { const s=Date.now(); await osascript(`tell application "System Events" to keystroke "${esc(t)}"`); return ok("type",A,s); }
  async read()             { const s=Date.now(); const r=await osascript(`tell application "System Events" to tell process "${P}" to return name of window 1`); return ok("read",A,s,{title:r}); }
})();
function d(ms:number){return new Promise(r=>setTimeout(r,ms));}
