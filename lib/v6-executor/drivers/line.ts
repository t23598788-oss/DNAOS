import { BaseDriver, ok, fail } from "./base";
import { osascript, esc } from "@/lib/v6-executor/runtime/shell";
const A = "LINE", P = "LINE";
const key = (s: string) => osascript(`tell application "System Events" to ${s}`);

export default new (class extends BaseDriver {
  appName = A; bundleId = "jp.naver.line.mac";
  constructor() { super(P); }
  async search(q: string) { const s=Date.now(); await key(`keystroke "f" using command down`); await d(300); await key(`keystroke "${esc(q)}"`); return ok("search",A,s,{q}); }
  async click(t: string)  { const s=Date.now(); if(t==="chat"||t==="submit") await key(`key code 36`); return ok("click",A,s,{t}); }
  async type(t: string)   { const s=Date.now(); await osascript(`set the clipboard to "${esc(t)}"`); await d(100); await key(`keystroke "v" using command down`); return ok("type",A,s); }
  async read()             { const s=Date.now(); try { const r=await osascript(`tell application "System Events" to tell process "${P}" to return name of window 1`); return ok("read",A,s,{title:r}); } catch(e) { return fail("read",A,s,(e as Error).message); } }
})();
function d(ms:number){return new Promise(r=>setTimeout(r,ms));}
