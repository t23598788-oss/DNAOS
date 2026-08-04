#!/usr/bin/env npx tsx
/**
 * Unit tests for services/ai-connection/hmac.ts. Pure functions, no DB
 * dependency — runnable now, before the Stage 1 migration is applied.
 * Run: AI_CONNECTION_TOKEN_PEPPER=test-pepper npx tsx scripts/ai-connection-hmac.test.ts
 */
process.env.AI_CONNECTION_TOKEN_PEPPER = process.env.AI_CONNECTION_TOKEN_PEPPER || "test-only-pepper-do-not-use-in-real-env"

import { hashToken, verifyTokenHash } from "@/services/ai-connection/hmac"

let pass = 0
let fail = 0

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`)
  }
}

console.log("\nAI Connection HMAC fallback tests\n" + "=".repeat(50))

const tokenA = "a".repeat(64)
const tokenB = "b".repeat(64)

const hashA = hashToken(tokenA)
const hashA2 = hashToken(tokenA)
const hashB = hashToken(tokenB)

check("hashToken is deterministic (same input -> same hash)", hashA === hashA2)
check("hashToken produces a 64-char hex digest (SHA-256)", /^[0-9a-f]{64}$/.test(hashA), hashA)
check("hashToken output differs for different inputs", hashA !== hashB)
check("verifyTokenHash accepts the correct token/hash pair", verifyTokenHash(tokenA, hashA))
check("verifyTokenHash rejects the wrong token against a stored hash", !verifyTokenHash(tokenB, hashA))
check("verifyTokenHash rejects a truncated hash safely (no throw)", (() => {
  try {
    return verifyTokenHash(tokenA, hashA.slice(0, 10)) === false
  } catch {
    return false
  }
})())

// Pepper sensitivity: same token, different pepper -> different hash.
// Proves this is NOT plain SHA-256 (which would ignore the pepper).
{
  const original = process.env.AI_CONNECTION_TOKEN_PEPPER
  process.env.AI_CONNECTION_TOKEN_PEPPER = "a-completely-different-pepper"
  const hashWithDifferentPepper = hashToken(tokenA)
  process.env.AI_CONNECTION_TOKEN_PEPPER = original
  check("hashToken output changes when the pepper changes (proves HMAC, not plain hash)", hashWithDifferentPepper !== hashA)
}

// Fail-closed: missing pepper must throw, never hash with an empty key.
{
  const original = process.env.AI_CONNECTION_TOKEN_PEPPER
  delete process.env.AI_CONNECTION_TOKEN_PEPPER
  let threw = false
  try {
    hashToken(tokenA)
  } catch {
    threw = true
  }
  process.env.AI_CONNECTION_TOKEN_PEPPER = original
  check("hashToken throws (fails closed) when AI_CONNECTION_TOKEN_PEPPER is unset", threw)
}

console.log("\n" + "=".repeat(50))
console.log(`${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
