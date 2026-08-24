# UPSTREAM REVIEW — Phase 4 steps 1 & 2

Evidence for the LICENSE_REVIEW and PIN gates. Nothing in this capability
may reference an upstream project that is not recorded here.

## Step 1 — LICENSE_REVIEW

### sandbox-runtime

| Field | Value |
|---|---|
| Repository | https://github.com/anthropic-experimental/sandbox-runtime |
| License | Apache-2.0 |
| Copyright | Copyright 2025 Anthropic |
| Deviation from standard text | None in the terms; the appendix boilerplate is filled in with "Copyright 2025 Anthropic" instead of the placeholder |
| Gate | **SAFE_TO_ADAPT** |

**Per-directory finding.** `vendor/` contains `java-proxy-agent/`,
`java-proxy-agent-src/`, `seccomp/`, `seccomp-src/`, `srt-win/`,
`srt-win-src/`, `build-common.ts` — a Java agent, Linux seccomp
components, and Windows components, several of which are committed
build outputs. **Per-file license verification of `vendor/` was NOT
completed and is therefore treated as unreviewed.**

This does not block Phase 4, because the only upstream file this
capability adapts is `src/sandbox/macos-sandbox-utils.ts`, on the macOS
Seatbelt path, which does not depend on `vendor/` at all. **Hard rule:
nothing under `vendor/` may be referenced, vendored, or adapted by DNA OS
until a separate per-file review clears it.**

**Attribution obligation (Apache-2.0 §4).** This capability adapts
technique, not source text — no upstream file is copied. The design
attribution is recorded in `./seatbelt.ts`'s header. If upstream source
text is ever copied verbatim in a later round, a `NOTICE` file becomes
mandatory at that point.

### node-pty

| Field | Value |
|---|---|
| Repository | https://github.com/microsoft/node-pty |
| License | MIT (three stacked MIT grants, no deviation) |
| Copyright | Christopher Jeffrey (2012–2015); Daniel Imms (2016); Microsoft Corporation (2018–present) |
| Gate | **SAFE_TO_ADAPT** |

**Outcome: node-pty is NOT imported, and no node-pty source is used.**
See `./pty.ts` for the real, empirically-forced reason (it is a native
addon requiring a build toolchain, and DNA OS's own launch path made a
simpler helper viable). Its *pattern* — a forkpty pair with a streaming
read loop — is what this capability implements. The license review is
recorded anyway so that adopting it later needs no new gate.

## Step 2 — PINNED UPSTREAM COMMITS

Every claim in this capability about upstream behaviour was read at
exactly these commits. Re-verify before citing a newer upstream state.

| Project | Pinned commit | Commit date |
|---|---|---|
| sandbox-runtime | `bcad38810efcc2b7342bbc6ec26d15b7bbbabcfb` | 2026-08-18 |
| node-pty | `56c6ac3b8abd523f09749a0ade9c69cd35e7d514` | 2026-08-13 |

Files actually read at those commits:

- `sandbox-runtime@bcad3881:src/sandbox/macos-sandbox-utils.ts` — Seatbelt
  profile generation: `(version 1)`, `(deny default (with message ...))`,
  last-match-wins rule ordering, read allow → deny → carve-out → re-deny,
  path escaping via `JSON.stringify()`, profile passed as a single
  argument to `sandbox-exec -p`.
- `sandbox-runtime@bcad3881:src/sandbox/sandbox-config.ts` — the
  `FilesystemConfigSchema` shape (`denyRead` / `allowRead` / `allowWrite` /
  `denyWrite`) and `NetworkConfigSchema` (`allowedDomains`,
  `deniedDomains`, `strictAllowlist`, `httpProxyPort`, `socksProxyPort`).

## What was taken, and what was not

**Taken (technique only, re-implemented from scratch in TypeScript):**

1. Escaping every caller-supplied path before it is interpolated into
   SBPL, instead of raw string interpolation. This is the fix for the
   confirmed injection vector in `./tests/adversarial-seatbelt.test.ts`.
2. The four-field filesystem policy shape (deny-read / allow-read-within-deny
   / allow-write / deny-write-within-allow) rather than DNA OS's previous
   two ad-hoc lists.
3. Emitting mandatory write denies (`.git/config`, `.git/hooks`) *inside*
   otherwise-writable regions.
4. Making the network boundary an explicit, declared policy value rather
   than an unstated consequence of `(deny default)`.

**Explicitly NOT taken:**

- No upstream source text is copied.
- The HTTP/SOCKS/MITM filtering proxy stack (`http-proxy.ts`,
  `socks-proxy.ts`, `tls-terminate-proxy.ts`, `mitm-ca.ts`, …) is **not**
  built this round — see `./types.ts`'s `NetworkPolicy` for the seam it
  would plug into and `./README.md` for why it is deferred.
- Everything Linux (`generate-seccomp-filter.ts`, `linux-*`) and Windows
  (`windows-sandbox-utils.ts`) is out of scope; DNA OS is macOS-only.
- The violation log-monitoring mechanism (`sandbox-violation-store.ts`,
  random log-tag suffix) is not adapted this round.
