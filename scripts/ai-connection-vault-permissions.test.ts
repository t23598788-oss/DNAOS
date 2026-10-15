#!/usr/bin/env npx tsx
/**
 * Live permission tests for the 3 ai_connection_vault_* RPC functions
 * (20260804000007_ai_connection_stage1.sql). Requires the migration to
 * already be applied — this hits the real Production database via the real
 * REST/service-role path, the same one the app itself uses.
 *
 * anon/authenticated denial is checked two ways:
 *  - a real HTTP REST call with the real anon key (end-to-end proof)
 *  - pg_proc.proacl inspected directly via `supabase db query --linked`
 *    (authoritative grant-table proof; also covers 'authenticated', which
 *    has no live JWT available to test end-to-end without a real login)
 *
 * Run: npx tsx scripts/ai-connection-vault-permissions.test.ts
 */
import { execSync } from "child_process"
import { readFileSync } from "fs"
import { join } from "path"
import { randomUUID } from "crypto"

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

function loadEnv(key: string): string {
  const envPath = join(process.cwd(), ".env.local")
  const content = readFileSync(envPath, "utf-8")
  const line = content.split("\n").find((l) => l.startsWith(`${key}=`))
  if (!line) throw new Error(`${key} not found in .env.local`)
  return line.slice(key.length + 1).trim()
}

const SUPA_URL = loadEnv("NEXT_PUBLIC_SUPABASE_URL")
const SUPA_ANON = loadEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
const SUPA_SERVICE = loadEnv("SUPABASE_SERVICE_ROLE_KEY")

async function callRpc(fn: string, key: string, body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  return { status: res.status, json }
}

async function main() {
  console.log("\nAI Connection Vault RPC permission tests\n" + "=".repeat(50))

  // ── 1. anon denied on all three (real REST calls) ──
  {
    const w = await callRpc("ai_connection_vault_write", SUPA_ANON, { p_secret: "x", p_name: "should-not-be-created" })
    check("anon denied on ai_connection_vault_write (real REST call)", w.status === 401, `got HTTP ${w.status}`)
  }
  {
    const r = await callRpc("ai_connection_vault_read", SUPA_ANON, { p_id: randomUUID() })
    check("anon denied on ai_connection_vault_read (real REST call)", r.status === 401, `got HTTP ${r.status}`)
  }
  {
    const d = await callRpc("ai_connection_vault_delete", SUPA_ANON, { p_id: randomUUID() })
    check("anon denied on ai_connection_vault_delete (real REST call)", d.status === 401, `got HTTP ${d.status}`)
  }

  // ── 2. anon / authenticated / PUBLIC denied, service_role granted — via pg_proc.proacl (authoritative) ──
  {
    const sql = "select proname, proacl from pg_proc where proname like 'ai_connection_vault_%' order by proname;"
    // CLI >= 2.120: `--output-format json` จำเป็น (default เป็น text/ตาราง ASCII) —
    // ส่งออกเป็น ARRAY ของ row; CLI เก่าคืน {rows:[...]} — รองรับทั้งสอง shape
    const out = execSync(`supabase db query --linked --output-format json "${sql}"`, { encoding: "utf-8" })
    const jsonStart = out.indexOf("[") === -1 ? out.indexOf("{") : Math.min(...[out.indexOf("["), out.indexOf("{")].filter((i) => i >= 0))
    const jsonEnd = Math.max(out.lastIndexOf(""), out.lastIndexOf("]"), out.lastIndexOf("}"))
    const parsed = JSON.parse(out.slice(jsonStart, jsonEnd + 1)) as { rows: { proname: string; proacl: string | null }[] } | { proname: string; proacl: string | null }[]
    const rows = Array.isArray(parsed) ? parsed : parsed.rows
    for (const row of rows) {
      const acl = row.proacl ?? ""
      check(`${row.proname}: no anon grant in proacl`, !acl.includes("anon="), acl)
      check(`${row.proname}: no authenticated grant in proacl`, !acl.includes("authenticated="), acl)
      check(`${row.proname}: no bare PUBLIC grant in proacl (no "=X/" entry without a role name)`, !/^\{?=X\//.test(acl) && !acl.includes(",=X/"), acl)
      check(`${row.proname}: service_role IS granted in proacl`, acl.includes("service_role="), acl)
    }
    check("exactly 3 ai_connection_vault_* functions exist (no extra/list function)", rows.length === 3, `found ${rows.length}`)
  }

  // ── 3. service_role can perform each operation — real round trip ──
  let createdId: string | null = null
  {
    const w = await callRpc("ai_connection_vault_write", SUPA_SERVICE, {
      p_secret: "permission-test-secret-value",
      p_name: `ai-connection-permtest-${Date.now()}`,
      p_description: "temporary, deleted by this test",
    })
    check("service_role can write a Vault secret", w.status === 200 && typeof w.json === "string", JSON.stringify(w))
    createdId = typeof w.json === "string" ? w.json : null
  }
  if (createdId) {
    const r = await callRpc("ai_connection_vault_read", SUPA_SERVICE, { p_id: createdId })
    check("service_role can read back the exact secret it wrote", r.status === 200 && r.json === "permission-test-secret-value", JSON.stringify(r))

    const d = await callRpc("ai_connection_vault_delete", SUPA_SERVICE, { p_id: createdId })
    check("service_role can delete the secret", d.status === 204, JSON.stringify(d))

    const r2 = await callRpc("ai_connection_vault_read", SUPA_SERVICE, { p_id: createdId })
    check("secret is really gone after delete (read returns null)", r2.status === 200 && r2.json === null, JSON.stringify(r2))
  } else {
    fail++
    console.log("  FAIL  (skipped read/delete/confirm — write did not return an id)")
  }

  // ── 4. nonexistent UUID: null / controlled error, no detail leak ──
  {
    const fakeId = randomUUID()
    const r = await callRpc("ai_connection_vault_read", SUPA_SERVICE, { p_id: fakeId })
    check("read on nonexistent UUID returns null (HTTP 200), not an error", r.status === 200 && r.json === null, JSON.stringify(r))

    const d = await callRpc("ai_connection_vault_delete", SUPA_SERVICE, { p_id: fakeId })
    check("delete on nonexistent UUID succeeds harmlessly (no row = no error)", d.status === 204, JSON.stringify(d))
  }

  console.log("\n" + "=".repeat(50))
  console.log(`${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error("TEST SCRIPT FAILED:", err instanceof Error ? err.message : err)
  process.exit(1)
})
