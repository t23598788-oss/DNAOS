import { BaseDriver, ok, fail } from "./base";
import { osascript, openUrl } from "@/lib/v6-executor/runtime/shell";
const A = "Google Maps";

export default new (class extends BaseDriver {
  appName = A; bundleId = "com.google.Chrome";
  constructor() { super("Google Chrome"); }
  async launch()           { const s=Date.now(); await openUrl("https://maps.google.com"); return ok("launch",A,s); }
  async search(q: string)  { const s=Date.now(); await openUrl(`https://maps.google.com/maps/search/${encodeURIComponent(q)}`); return ok("search",A,s,{q}); }
  async click(t: string)   { const s=Date.now(); if(t.startsWith("url:")) await openUrl(t.slice(4)); return ok("click",A,s,{t}); }
  async type(t: string)    { const s=Date.now(); await osascript(`tell application "System Events" to keystroke "${t}"`); return ok("type",A,s); }
  async read()              { const s=Date.now(); try { const u=await osascript(`tell application "Google Chrome" to return URL of active tab of window 1`); return ok("read",A,s,{url:u}); } catch(e) { return fail("read",A,s,(e as Error).message); } }
})();
