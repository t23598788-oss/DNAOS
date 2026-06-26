import { BaseDriver, ok } from "./base";
import { osascript, esc } from "@/lib/v6-executor/runtime/shell";
const A = "Calendar";
const key = (s: string) => osascript(`tell application "System Events" to ${s}`);

export default new (class extends BaseDriver {
  appName = A; bundleId = "com.apple.iCal";
  constructor() { super(A); }
  async search(q: string) { const s=Date.now(); await key(`keystroke "f" using command down`); await d(300); await key(`keystroke "${esc(q)}"`); return ok("search",A,s,{q}); }
  async click(t: string)  { const s=Date.now(); if(t==="new_event") await key(`keystroke "n" using command down`); else if(t==="submit") await key(`key code 36`); return ok("click",A,s,{t}); }
  async type(t: string)   { const s=Date.now(); await key(`keystroke "${esc(t)}"`); return ok("type",A,s); }
  async read()             { const s=Date.now(); const r=await osascript(`tell application "System Events" to tell process "${A}" to return name of window 1`); return ok("read",A,s,{title:r}); }
})();
function d(ms:number){return new Promise(r=>setTimeout(r,ms));}
