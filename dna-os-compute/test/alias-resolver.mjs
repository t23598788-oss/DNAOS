/**
 * Aliases "@/" to the repo root for the Phase 4 mTLS test — IN-REPO so the
 * test is reproducible on any clone (Business tsconfig paths equivalent).
 *
 * Covers BOTH module systems used on this chain:
 *  - CJS require(): patches Module._resolveFilename (tsx owns resolvers, so
 *    registerHooks alone does not reach the require() stack of the Business
 *    relay files, which the root package.json compiles as CommonJS)
 *  - ESM import(): node:module registerHooks (Node >= 22.15)
 *
 * Run (fallback; the trust-mtls test also passes WITHOUT this hook by
 * running tsx from the repo ROOT, where the root tsconfig provides the
 * '@/…' paths mapping itself):
 *   cd dna-os-compute && npx tsx --test --import ./test/alias-resolver.mjs test/trust-mtls.test.ts
 *
 * Known limit under tsx: for CJS require() chains tsx's own resolver wraps
 * this patch (tsx registers first), so '@/…' requests reaching the inner
 * resolver can still fail when it cannot consult the ROOT tsconfig (this
 * package's tsconfig has no paths). The ESM registerHooks branch is the
 * reliable one; the CJS patch is best-effort.
 */
import Module from "node:module";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// test/alias-resolver.mjs → dna-os-compute → repo root
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RESOLVE_ORDER = ["", ".ts", ".tsx", "/index.ts", ".json"];

// ── CJS require() patch (Module._resolveFilename) ─────────────────────────
const originalResolveFilename = Module._resolveFilename;
if (typeof originalResolveFilename === "function") {
  const patched = function patchedResolveFilename(request, parent, isMain, options) {
    if (typeof request === "string" && request.startsWith("@/")) {
      const sub = request.slice(2);
      for (const ext of RESOLVE_ORDER) {
        const abs = join(REPO_ROOT, sub + ext);
        try {
          fs.accessSync(abs);
          return originalResolveFilename.call(this, abs, parent, isMain, options);
        } catch { /* try next extension */ }
      }
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };
  Module._resolveFilename = patched;
}

// ── ESM import() hook (when the chain loads as ESM) ───────────────────────
if (typeof Module.registerHooks === "function") {
  Module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
      for (const ext of RESOLVE_ORDER) {
        try {
          return nextResolve(new URL(`file://${join(REPO_ROOT, specifier.slice(2) + ext)}`).href, context);
        } catch { /* try next extension */ }
      }
      return nextResolve(specifier, context);
    },
  });
}
