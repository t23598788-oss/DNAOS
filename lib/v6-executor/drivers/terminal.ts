import { BaseDriver, ok } from "./base";
import { osascript, esc } from "@/lib/v6-executor/runtime/shell";
const A = "Terminal";

export default new (class extends BaseDriver {
  appName = A; bundleId = "com.apple.Terminal";
  constructor() { super(A); }
  async search(q: string) { const s=Date.now(); await osascript(`tell application "${A}" to do script "find . -name \\"${esc(q)}\\""`); return ok("search",A,s,{q}); }
  async click(t: string)  { const s=Date.now(); if(t==="submit") await osascript(`tell application "System Events" to key code 36`); return ok("click",A,s,{t}); }
  async type(t: string)   { const s=Date.now(); await osascript(`tell application "${A}" to do script "${esc(t)}" in selected tab of window 1`); return ok("type",A,s,{cmd:t}); }
  async read()             { const s=Date.now(); const r=await osascript(`tell application "${A}" to return contents of selected tab of window 1`); return ok("read",A,s,{content:r.slice(-500)}); }
})();
