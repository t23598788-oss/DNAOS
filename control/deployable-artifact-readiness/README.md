# control/deployable-artifact-readiness/

One job: given an already-VERIFIED commit (`control/post-commit-verification/`), decide whether it has a real, deployable artifact ready to hand to a (not-yet-built) Deployment Pipeline. No cloud provider, no Vercel, no deploy.

```
VERIFIED COMMIT -> PROJECT/RUNTIME DISCOVERY -> BUILD REQUIREMENT RESOLUTION
  -> BUILD EXECUTION -> ARTIFACT DISCOVERY -> ARTIFACT VALIDATION
  -> READY | FAILED | UNRESOLVED | BUILD_NOT_REQUIRED -> STOP
```

## Runtime discovery (`./runtime-discovery.ts`)

Reads only real marker files at the repo root (`package.json`, lockfiles, `tsconfig.json`, framework configs, `Dockerfile`, `Makefile`, etc.) — every fact traces to one specific file. Never an AI guess.

## Build requirement resolution (`./build-requirement-resolution.ts`)

`package.json` `scripts.build` → REQUIRED. No build script but `tsconfig.json`'s `noEmit: true` plus every `.ts` script running directly via `tsx`/`ts-node` → NOT_REQUIRED (proven, not assumed). A `Dockerfile`/`Makefile build:` target with no npm script and no registered executor → UNRESOLVED (never fabricates a docker/make executor). Otherwise → UNRESOLVED.

## Build execution (`./run-build.ts`)

Reuses `execution/run/` + `permissions/execution-policy/` — same pattern as `control/post-commit-verification/run-checks.ts`. No new shell engine.

## Artifact discovery/validation

Framework → output path is each framework's own documented default (Next.js `.next/`, Vite `dist/`) — never a blanket `dist/` assumption. A generic project falls back to its real `package.json` `main` field. Validation checks existence, non-emptiness, commit match, type match, required marker files, path-escape, and cache/temp exclusion — never re-runs a security scan, test, or typecheck (each has its own owner elsewhere).

## Decision (`./decision.ts`)

Pure. `READY` only when a real build PASSED and a real artifact validated `ok===true`. `BUILD_NOT_REQUIRED` is a coequal terminal outcome, never folded into `READY`.
