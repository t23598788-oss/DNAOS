import { readFileSync } from "node:fs"
import { dispatch } from "../engines/validation/dispatcher"

const src = readFileSync("engines/validation/dispatcher.ts", "utf8")
const handlers = [...src.matchAll(/^\s{2}"([a-z][a-z0-9._]+)":\s+async/gm)].map((m) => m[1])
const reg = JSON.parse(readFileSync("registry/command-registry.json", "utf8"))
const declared = new Set(Object.keys(reg.commands ?? {}))
const qc = Object.keys(reg.query_constraints ?? {})
console.log("handlers:", handlers.length, "| registry commands:", declared.size, "| query_constraints:", qc.length)
const missing = handlers.filter((h) => !declared.has(h))
console.log("handlers MISSING from commands registry:", missing.join(", ") || "(none)")
for (const h of missing) console.log("  in query_constraints?", qc.includes(h) ? "YES" : "no")
process.exit(0)
