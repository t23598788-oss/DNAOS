import { BaseDriver, ok, fail } from "./base";
import { osascript, esc, shell } from "@/lib/runtime/shell";
const A = "VS Code", P = "Visual Studio Code";

export default new (class extends BaseDriver {
  appName = A; bundleId = "com.microsoft.VSCode";
  constructor() { super(P); }
  async search(q: string) { const s=Date.now(); if(q.includes("/")||q.includes(".")) await shell("code",[q]); else { await osascript(`tell application "System Events" to keystroke "p" using command down`); await d(300); await osascript(`tell application "System Events" to keystroke "${esc(q)}"`); } return ok("search",A,s,{q}); }
  async click(t: string)  { const s=Date.now(); if(t==="terminal") await osascript(`tell application "System Events" to keystroke "\`" using control down`); else if(t.startsWith("shortcut:")) await osascript(`tell application "System Events" to keystroke "${esc(t.slice(9))}" using command down`); return ok("click",A,s,{t}); }
  async type(t: string)   { const s=Date.now(); await osascript(`tell application "System Events" to keystroke "${esc(t)}"`); return ok("type",A,s); }
  async read()             { const s=Date.now(); try { const r=await osascript(`tell application "System Events" to tell process "Code" to return name of window 1`); return ok("read",A,s,{title:r}); } catch(e) { return fail("read",A,s,(e as Error).message); } }
})();
function d(ms:number){return new Promise(r=>setTimeout(r,ms));}
