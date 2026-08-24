# Repository Audit — 7 Repos (Read-Only)

Audit date: 2026-08-16
Method: GitHub API via authenticated `gh` CLI (read-only). No clones, no writes, no repository changes made.
Account: t23598788-oss

---

## 1. t23598788-oss/Downloads

- REPO: Downloads
- CLASSIFICATION: EMPTY
- HAS_REAL_CODE: NO
- SOURCE_COUNT: 0
- RUNTIME_ENTRYPOINT: none
- HAS_TESTS: NO
- HAS_DEPLOYMENT: NO
- BRANCH_COUNT: 1 (main)
- COMMIT_COUNT: 1
- LIKELY_PURPOSE: Unknown — repo contains only an auto-generated `README.md` with a single-line title. No code, no description. Possibly created accidentally (name suggests a local folder was pushed as a placeholder, or repo was scaffolded and abandoned before any content was added).
- DUPLICATION: None (nothing to duplicate)
- EVIDENCE: `default_branch=main`, `size=0`, single commit "Initial commit" by t23598788-oss on 2026-05-14, tree = [`README.md`] only.
- RECOMMENDATION: ARCHIVE_CANDIDATE

---

## 2. t23598788-oss/nextjs

- REPO: nextjs
- CLASSIFICATION: SCAFFOLD_TEMPLATE
- HAS_REAL_CODE: NO
- SOURCE_COUNT: 3 (`app/layout.tsx`, `app/page.tsx`, `app/globals.css`) — all unmodified `create-next-app` defaults
- RUNTIME_ENTRYPOINT: `app/page.tsx` (Next.js App Router default route)
- HAS_TESTS: NO
- HAS_DEPLOYMENT: Evidence present but unused — repo was "Created from https://vercel.com/new" (Vercel one-click import), no custom `vercel.json`
- BRANCH_COUNT: 1 (main)
- COMMIT_COUNT: 1
- LIKELY_PURPOSE: Vercel-generated Next.js starter, created via Vercel's "New Project" flow and pushed once. README is the stock `create-next-app` boilerplate, unedited. No application logic added.
- DUPLICATION: Shares scaffold pattern (Next.js app router, same boilerplate structure) with mcp-with-next-js-and-descope, but no identical source files — that repo has added real routes on top of a similar base.
- EVIDENCE: `package.json` name="nextjs", deps: next 16.2.4/react 19.2.4; commit message "Initial commit\n\nCreated from https://vercel.com/new"; README is verbatim create-next-app template text.
- RECOMMENDATION: ARCHIVE_CANDIDATE

---

## 3. t23598788-oss/express-js-on-vercel

- REPO: express-js-on-vercel
- CLASSIFICATION: SCAFFOLD_TEMPLATE
- HAS_REAL_CODE: PARTIAL — minor customization on top of a Vercel example (routes: `/`, `/about`, `/api-data`, `/healthz`), but no unique business logic
- SOURCE_COUNT: 2 (`src/index.ts`, `components/about.htm`)
- RUNTIME_ENTRYPOINT: `src/index.ts` (Express app, exported default, Vercel serverless-style)
- HAS_TESTS: NO
- HAS_DEPLOYMENT: YES — built explicitly for Vercel deployment (per README/name), no `vercel.json` found but structured as a Vercel serverless function per the linked official Vercel example
- BRANCH_COUNT: 1 (main)
- COMMIT_COUNT: 1
- LIKELY_PURPOSE: Learning/reference project based on Vercel's official "solutions/express" example — demonstrates a minimal Express app with a couple of routes and a health check. No evidence of production use.
- DUPLICATION: None with the other 6 repos.
- EVIDENCE: README explicitly says "Basic Express.js + Vercel example," links to `vercel/examples` repo as source; single "Initial commit / Created from https://vercel.com/new".
- RECOMMENDATION: ARCHIVE_CANDIDATE

---

## 4. t23598788-oss/mcp-with-next-js-and-descope

- REPO: mcp-with-next-js-and-descope
- CLASSIFICATION: PROTOTYPE
- HAS_REAL_CODE: PARTIAL — real MCP route handlers and auth wiring exist (`app/api/[transport]/route.ts`, `app/.well-known/oauth-protected-resource/route.ts`), but the tool surface is limited to a single "echo" demo tool per README
- SOURCE_COUNT: ~7 (`app/api/[transport]/route.ts`, `app/.well-known/oauth-protected-resource/route.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `scripts/test-client.mjs`, `scripts/test-streamable-http-client.mjs`)
- RUNTIME_ENTRYPOINT: `app/api/[transport]/route.ts` (MCP server endpoint), `app/page.tsx` (web entry)
- HAS_TESTS: PARTIAL — two manual test-client scripts (`scripts/test-client.mjs`, `scripts/test-streamable-http-client.mjs`), not an automated test suite
- HAS_DEPLOYMENT: YES — README includes a "Deploy with Vercel" button pointing at `descope/ai` example repo, `.env.example` present for required env vars
- BRANCH_COUNT: 1 (main)
- COMMIT_COUNT: 1
- LIKELY_PURPOSE: Reference/example implementation combining Vercel's MCP Handler with Descope authentication, based on Descope's official example (`descope/ai/examples/nextjs-vercel-mcp-server`). Built to demonstrate MCP + OAuth session validation, not a standalone product.
- DUPLICATION: Similar Next.js scaffold shape to `nextjs` repo (app router, next.config.ts, tailwind), but distinct added routes/logic — not a file-level duplicate.
- EVIDENCE: README explicitly documents it as "This example shows how to build an MCP server..."; `package.json` name="mcp-server-descope-nextjs"; deploy link targets `descope/ai` upstream repo, not this account's own infra.
- RECOMMENDATION: MERGE_REVIEW

---

## 5. t23598788-oss/LINEOA

- REPO: LINEOA
- CLASSIFICATION: README_ONLY
- HAS_REAL_CODE: NO
- SOURCE_COUNT: 0
- RUNTIME_ENTRYPOINT: none
- HAS_TESTS: NO
- HAS_DEPLOYMENT: NO
- BRANCH_COUNT: 3 (main, README.md, dna-os-architecture) — all three branches point to the same 1-commit history (README only)
- COMMIT_COUNT: 1 (identical across all 3 branches)
- LIKELY_PURPOSE: Intended as a "resource/material and cash-flow management system for on-site work and people in the real world" per the repo description (Thai-language), but no implementation exists yet — only a title-only README and branch names suggesting planned architecture work (`dna-os-architecture`) that was never populated.
- DUPLICATION: None (no source to compare).
- EVIDENCE: repo description field (Thai text) is the only substantive content; `README.md` body is just `# LINEOA`; extra branch names (`README.md`, `dna-os-architecture`) exist but contain no additional commits/content beyond the same single initial commit.
- RECOMMENDATION: MERGE_REVIEW

---

## 6. t23598788-oss/--index.jsx

- REPO: --index.jsx
- CLASSIFICATION: EMPTY
- HAS_REAL_CODE: NO
- SOURCE_COUNT: 0
- RUNTIME_ENTRYPOINT: none
- HAS_TESTS: NO
- HAS_DEPLOYMENT: NO
- BRANCH_COUNT: 0 (no branches — git-empty repository)
- COMMIT_COUNT: 0
- LIKELY_PURPOSE: Unknown. Repository was created (2026-06-14) but never received a single commit or push. The name itself (`--index.jsx`, leading double-dash) suggests an accidental/malformed repo creation, possibly from a CLI argument-parsing mistake (`--index.jsx` being consumed as a flag rather than a filename) rather than an intentional project.
- DUPLICATION: None (no content).
- EVIDENCE: GitHub API returns `409 Git Repository is empty` for both `/commits` and `/git/trees` endpoints; `size=0`; `created_at` = `updated_at` = `pushed_at` (no activity since creation).
- RECOMMENDATION: DELETE_REVIEW

---

## 7. t23598788-oss/camo

- REPO: camo
- CLASSIFICATION: LEGACY
- HAS_REAL_CODE: YES (but not authored by this account — see below)
- SOURCE_COUNT: ~6 (`server.js`, `server.coffee`, `mime-types.json`, plus test files)
- RUNTIME_ENTRYPOINT: `server.js` / `server.coffee` (per `Procfile`/`package.json` engine config)
- HAS_TESTS: YES — `test/app_test.rb`, `test/proxy_test.rb` (Ruby-based integration tests against the Node server), plus fixture servers under `test/servers/`
- HAS_DEPLOYMENT: YES — `Procfile` (Heroku), `Dockerfile`, `app.json` (Heroku Button config), `.travis.yml` (CI)
- BRANCH_COUNT: 1 (master)
- COMMIT_COUNT: 398 (all inherited from upstream history; none authored by this account)
- LIKELY_PURPOSE: This is a **fork of the original `atmos/camo` project** (an HTTP image-proxy that routes external images through SSL to avoid mixed-content warnings). It was forked into this account on 2026-05-10 but never modified — the latest commit (`e59df56`) is dated 2017-09-09, authored by the original maintainer Corey Donohoe (`atmos@atmos.org`). No commits exist from t23598788-oss.
- DUPLICATION: None with the other 6 repos (unrelated codebase, Ruby/CoffeeScript/Node stack).
- EVIDENCE: `parent.full_name` = `atmos/camo`, `source.full_name` = `atmos/camo` (GitHub fork metadata); `fork=true`; last commit author is the upstream maintainer, not this account; `package.json` `engines.node = "^6.11.1"` (2017-era Node), zero runtime dependencies declared.
- RECOMMENDATION: ARCHIVE_CANDIDATE

---

## Summary

### Classification counts

| Classification | Count |
|---|---|
| TOTAL_REPOS | 7 |
| ACTIVE_CODE | 0 |
| PROTOTYPE | 1 (mcp-with-next-js-and-descope) |
| SCAFFOLD_TEMPLATE | 2 (nextjs, express-js-on-vercel) |
| README_ONLY | 1 (LINEOA) |
| EMPTY | 2 (Downloads, --index.jsx) |
| LEGACY | 1 (camo) |
| UNKNOWN | 0 |

### Recommendation groups

- **RENAME_CANDIDATES:** none identified (no rename recommendations made per instructions — no repo qualified as an active, correctly-scoped project needing only a name fix)
- **MERGE_REVIEW:** LINEOA, mcp-with-next-js-and-descope
- **ARCHIVE_CANDIDATES:** Downloads, nextjs, express-js-on-vercel, camo
- **DELETE_REVIEW:** --index.jsx

### Flat factual list (7 repos)

1. t23598788-oss/Downloads — private, empty except README, 1 commit
2. t23598788-oss/nextjs — private, unmodified Next.js scaffold, 1 commit
3. t23598788-oss/express-js-on-vercel — private, minimally-customized Vercel Express example, 1 commit
4. t23598788-oss/mcp-with-next-js-and-descope — private, MCP+Descope reference implementation, 1 commit
5. t23598788-oss/LINEOA — private, README-only (Thai description, 3 branches, no code), 1 commit
6. t23598788-oss/--index.jsx — private, git-empty repository, 0 commits, 0 branches
7. t23598788-oss/camo — public, unmodified fork of atmos/camo, 398 inherited commits, last activity 2017

---

**Audit complete. No repository changes were made. Stopping per instructions.**
