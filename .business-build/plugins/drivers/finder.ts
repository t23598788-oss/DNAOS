import { BaseDriver, ok } from "./base";
import { osascript, esc } from "@/plugins/runtime/shell";
const A = "Finder";

export default new (class extends BaseDriver {
  appName = A; bundleId = "com.apple.finder";
  constructor() { super(A); }
  async search(q: string) { const s=Date.now(); await osascript(`tell application "${A}" to open POSIX file "${esc(q)}"`); return ok("search",A,s,{path:q}); }
  async click(t: string)  { const s=Date.now(); if(t==="new_folder") await osascript(`tell application "System Events" to keystroke "n" using {command down, shift down}`); return ok("click",A,s,{t}); }
  async type(t: string)   { const s=Date.now(); await osascript(`tell application "System Events" to keystroke "${esc(t)}"`); return ok("type",A,s); }
  async read()             { const s=Date.now(); const r=await osascript(`tell application "${A}" to set sel to selection\nset p to {}\nrepeat with f in sel\nset end of p to POSIX path of (f as alias)\nend repeat\nreturn p as text`); return ok("read",A,s,{selected:r}); }
  async close()            { const s=Date.now(); await osascript(`tell application "${A}" to close every window`); return ok("close",A,s); }
})();
