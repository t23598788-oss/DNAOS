# local-runtime/dna-dev-app-host

**Capability:** `dna-dev-app-host` — the governed source of **DNA DEV.app**, the
Owner's desktop entrypoint to the DNA OS control UI.

## Why this folder exists

Before 2026-08-24, `DNA DEV.app` on the Desktop contained a hand-written
launcher that ran `open "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE"` — it opened a
**Finder window**, not a UI. It had no API, no data path, and no owning
capability, so the Write Gate correctly returned `DENY / NO_MATCHING_CAPABILITY`
for any attempt to repair it in place.

Owner decision (2026-08-24, Option 1): establish canonical source ownership
first, build the artifact from that source, then install it.

**The Desktop bundle is a generated, installed artifact. This folder is the
canonical source. Never hand-edit the installed bundle.**

## Launch target — discovered, not chosen

`./config.ts` declares the canonical target and carries the evidence that proves
it. Summary: `.railway/railway.ts` classifies `dna-os-circuit` as
`UI_APP — real reachable URL` and `owner-command-http` as
`API_SERVICE, not a UI`; the circuit board's own `index.html` calls itself
*"Phase 20 — the one Owner-facing entry"*.

    https://dna-os-circuit-production.up.railway.app   (Railway service: dna-os-circuit)

There is **no silent localhost fallback**. `LOCAL_TARGET` exists and is named, but
`resolveLaunchTarget` requires an explicit opt-in.

## Use

    ./build.sh     # assemble build/DNA DEV.app + build/build-manifest.json
    ./install.sh   # copy to ~/Desktop and PROVE installed bytes == built bytes

`install.sh` recomputes hashes from the installed bundle rather than trusting the
manifest, preserves any existing Desktop bundle as `.superseded-<ts>`, and exits
non-zero if provenance does not match.

## Pattern

Follows `connections/voice-command/app-host/build.sh` (manual `Contents/` layout,
`xattr -cr`, ad-hoc `codesign` with a stable identifier) **without importing its
internals** — Capability Folder Law rule 9. That capability is
purpose-specific (swiftc + microphone + Speech Recognition + TCC,
`LSUIElement=true`); this one opens a URL and is `LSUIElement=false`. Classified
NOT DUPLICATE / NOT OVERLAPPING under rule 4.

## Honest limits

- `app.icns` is optional. The build only uses a governed copy in this folder; it
  never reaches outside the capability boundary to fetch one. With no icon
  present the bundle shows the system default.
- Ad-hoc `codesign` only — no Developer ID signing or notarization.
