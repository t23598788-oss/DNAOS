import { BaseDriver, ok, fail } from "./base";
import { osascript } from "@/plugins/runtime/shell";
const A = "Google Earth", P = "Google Earth Pro";

export default new (class extends BaseDriver {
  appName = A; bundleId = "com.google.earth";
  constructor() { super(P); }
  async search(q: string) { const s=Date.now(); try { await osascript(`tell application "${P}" to SearchLocation "${q}"`); return ok("search",A,s,{q}); } catch(e) { return fail("search",A,s,(e as Error).message); } }
  async click(t: string)  { return ok("click",A,Date.now(),{t}); }
  async type(t: string)   { const s=Date.now(); await osascript(`tell application "System Events" to keystroke "${t}"`); return ok("type",A,s); }
  async read()             { const s=Date.now(); try { const r=await osascript(`tell application "System Events" to tell process "${P}" to return name of window 1`); return ok("read",A,s,{title:r}); } catch(e) { return fail("read",A,s,(e as Error).message); } }
})();
