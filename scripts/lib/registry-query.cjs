#!/usr/bin/env node
// Node-based replacement for the `jq` queries governance bash scripts used
// (owner, 2026-07-18) — root cause of every Vercel deploy failing since at
// least 2026-07-15: `jq` is a local/macOS tool, never present in Vercel's
// build environment, so scripts/check-registry.sh, check-commands.sh, and
// check-imports.sh failed at "ERROR: jq is required" before `next build`
// ever ran (Rule 109 — Environment Verification Before Audit: a script
// assumed a binary existed without checking). Node IS always present (this
// runs inside the same `npm run build`), so every jq expression those
// scripts used is reproduced here as a named subcommand instead — no new
// dependency, no environment assumption.
//
// Each subcommand mirrors exactly ONE jq expression that was previously
// inline in a bash script — see registry/CHANGELOG.json DNA-000078 for the
// mapping from old jq call to new subcommand.

const fs = require("fs");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function out(lines) {
  for (const l of lines) console.log(l);
}

const [, , cmd, file, ...rest] = process.argv;

try {
  const data = file ? readJson(file) : null;

  switch (cmd) {
    // .<section> | keys[]
    case "keys": {
      const [section] = rest;
      out(Object.keys(data[section] || {}));
      break;
    }

    // .commands | to_entries[] | select(.key | startswith("_") | not) | .value.owner  (sorted, unique)
    case "command-owners": {
      const owners = Object.entries(data.commands || {})
        .filter(([k]) => !k.startsWith("_"))
        .map(([, v]) => v.owner)
        .filter(Boolean);
      out([...new Set(owners)].sort());
      break;
    }

    // .<section> | to_entries[] | select(.key startswith("_") | not) | select(.value.<field> == <value>) | .key
    case "keys-where": {
      const [section, field, value] = rest;
      const parsedValue = value === "true" ? true : value === "false" ? false : value;
      const keys = Object.entries(data[section] || {})
        .filter(([k, v]) => !k.startsWith("_") && v[field] === parsedValue)
        .map(([k]) => k);
      out(keys);
      break;
    }

    // Same as keys-where, but for .value.<field> == null / missing
    case "keys-where-null": {
      const [section, field] = rest;
      const keys = Object.entries(data[section] || {})
        .filter(([k, v]) => !k.startsWith("_") && (v[field] === undefined || v[field] === null))
        .map(([k]) => k);
      out(keys);
      break;
    }

    // .<section> | keys | length
    case "count-keys": {
      const [section] = rest;
      console.log(Object.keys(data[section] || {}).length);
      break;
    }

    // .workflows // {} | to_entries[] | .value.steps_commands? // [] | .[]
    case "workflow-steps": {
      const workflows = data.workflows || {};
      const result = [];
      for (const v of Object.values(workflows)) {
        for (const s of v.steps_commands || []) result.push(s);
      }
      out(result);
      break;
    }

    // .allowed_imports | to_entries[] | .key as $src | .value[] | "\($src):\(.)"
    case "allowed-edges": {
      const allowed = data.allowed_imports || {};
      const result = [];
      for (const [src, targets] of Object.entries(allowed)) {
        for (const t of targets) result.push(`${src}:${t}`);
      }
      out(result);
      break;
    }

    // .known_mistakes.confirmed_duplicate_pairs.pairs[] | [.deprecated, .keep, .reason] | @tsv
    case "dup-pairs-tsv": {
      const pairs = data.known_mistakes?.confirmed_duplicate_pairs?.pairs || [];
      out(pairs.map((p) => `${p.deprecated}\t${p.keep}\t${p.reason}`));
      break;
    }

    default:
      console.error(`Unknown subcommand: ${cmd}`);
      process.exit(1);
  }
} catch {
  // Matches the old `jq ... 2>/dev/null || true` tolerance already present
  // at several call sites (missing/malformed file → empty result, not a
  // hard crash) — same behavior, just implemented in Node instead of jq.
  process.exit(0);
}
