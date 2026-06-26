import { BaseDriver, ok } from "./base";
import { osascript, esc } from "@/lib/v6-executor/runtime/shell";
const A = "Mail";
const key = (s: string) => osascript(`tell application "System Events" to ${s}`);

export default new (class extends BaseDriver {
  appName = A; bundleId = "com.apple.mail";
  constructor() { super(A); }
  async search(q: string) { const s=Date.now(); await key(`keystroke "f" using {command down, option down}`); await d(300); await key(`keystroke "${esc(q)}"`); return ok("search",A,s,{q}); }
  async click(t: string)  { const s=Date.now(); if(t==="compose") await key(`keystroke "n" using command down`); else if(t==="subject"||t==="body") await key(`key code 48`); else if(t.startsWith("shortcut:")) await key(`keystroke "${esc(t.slice(9))}" using {command down, shift down}`); return ok("click",A,s,{t}); }
  async type(t: string)   { const s=Date.now(); await key(`keystroke "${esc(t)}"`); return ok("type",A,s); }
  async read()             { const s=Date.now(); const r=await osascript(`tell application "${A}" to return count of messages of inbox`); return ok("read",A,s,{inbox:r}); }
})();
function d(ms:number){return new Promise(r=>setTimeout(r,ms));}
