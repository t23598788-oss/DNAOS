import { BaseDriver, ok, fail } from "./base";
import { osascript, esc } from "@/lib/runtime/shell";
const A = "GitHub Desktop";
const key = (s: string) => osascript(`tell application "System Events" to ${s}`);

export default new (class extends BaseDriver {
  appName = A; bundleId = "com.github.GitHubClient";
  constructor() { super(A); }
  async search(q: string) { const s=Date.now(); await key(`keystroke "f" using command down`); await d(300); await key(`keystroke "${esc(q)}"`); return ok("search",A,s,{q}); }
  async click(t: string)  { const s=Date.now(); if(t==="commit"||t==="submit") await key(`keystroke return using command down`); else if(t==="push"||t==="shortcut:p") await key(`keystroke "p" using command down`); else if(t==="pull") await key(`keystroke "p" using {command down, shift down}`); return ok("click",A,s,{t}); }
  async type(t: string)   { const s=Date.now(); await key(`keystroke "${esc(t)}"`); return ok("type",A,s); }
  async read()             { const s=Date.now(); try { const r=await osascript(`tell application "System Events" to tell process "${A}" to return name of window 1`); return ok("read",A,s,{title:r}); } catch(e) { return fail("read",A,s,(e as Error).message); } }
})();
function d(ms:number){return new Promise(r=>setTimeout(r,ms));}
