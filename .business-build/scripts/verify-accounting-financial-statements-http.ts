import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { once } from "node:events"
import { chromium } from "playwright"

const user = { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.test" }

const rows: Record<string, unknown[]> = {
  profiles: [{ role: "admin" }],
  // Canonical sources only — exactly the tables the PHASE E5.1 route queries:
  // document_canonical / payment_allocations / company_debt_current + evidence
  // tables. A VOID row and a quotation row are present to prove the route
  // excludes them from revenue.
  document_canonical: [
    { document_kind: "sales", document_type: "invoice", document_status: "ISSUED", issue_date: "2026-09-01", subtotal: 9090.91, discount_amount: 0, vat_amount: 909.09, gross_amount: 10000, total_amount: 10000, wht_amount: 0, net_payable: 10000, paid_amount: 0, data_completeness: "complete" },
    { document_kind: "sales", document_type: "quotation", document_status: "ISSUED", issue_date: "2026-09-02", subtotal: 90909.09, discount_amount: 0, vat_amount: 9090.91, gross_amount: 99999, total_amount: 99999, wht_amount: 0, net_payable: 99999, paid_amount: 0, data_completeness: "complete" },
    { document_kind: "sales", document_type: "invoice", document_status: "VOID", issue_date: "2026-09-03", subtotal: 50000, discount_amount: 0, vat_amount: 0, gross_amount: 50000, total_amount: 50000, wht_amount: 0, net_payable: 50000, paid_amount: 0, data_completeness: "complete" },
  ],
  payment_allocations: [{ amount: 7000, allocated_at: "2026-09-05" }],
  company_debt_current: [{ ledger_outstanding: 3000, snapshot_total_outstanding: 3000 }],
  receipt_documents: [
    { amount: 500, document_date: "2026-09-06", document_type: "fuel_bill", status: "confirmed" },
    { amount: 1200, document_date: "2026-09-07", document_type: "transfer_slip", status: "pending" },
  ],
  fuel_price_log: [{ price: "35.50", fetched_at: "2026-09-07T00:00:00Z" }],
  company_expenses: [{ document_type: "receipt", vendor_name: "Test Vendor", amount: 2000, expense_date: "2026-09-08" }],
}

function json(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  const origin = req.headers.origin ?? "*"
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "authorization, apikey, content-type, x-client-info",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  })
  res.end(JSON.stringify(body))
}

function startFakeSupabase() {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "OPTIONS") return json(req, res, 200, {})
    const url = new URL(req.url ?? "/", "http://127.0.0.1")

    if (url.pathname === "/auth/v1/token" && req.method === "POST") {
      return json(req, res, 200, {
        access_token: "test-access-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "test-refresh-token",
        user: { ...user, aud: "authenticated", role: "authenticated" },
      })
    }

    if (url.pathname === "/auth/v1/user" && req.method === "GET") {
      const auth = req.headers.authorization ?? ""
      if (auth !== "Bearer test-access-token") return json(req, res, 401, { message: "missing test token" })
      return json(req, res, 200, { ...user, aud: "authenticated", role: "authenticated" })
    }

    if (url.pathname.startsWith("/rest/v1/") && req.method === "GET") {
      const table = url.pathname.replace("/rest/v1/", "")
      const body = rows[table]
      if (!body) return json(req, res, 404, { message: `unknown table ${table}` })
      if (table === "profiles" && req.headers.accept?.includes("vnd.pgrst.object")) {
        return json(req, res, 200, body[0])
      }
      return json(req, res, 200, body)
    }

    return json(req, res, 404, { message: `${req.method} ${url.pathname} not handled by test Supabase` })
  })

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (url.pathname !== "/realtime/v1/websocket") {
      socket.destroy()
      return
    }

    const key = req.headers["sec-websocket-key"]
    if (!key || Array.isArray(key)) {
      socket.destroy()
      return
    }

    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64")
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"))
  })

  return new Promise<{ server: ReturnType<typeof createServer>; url: string }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      assert(address && typeof address === "object")
      resolve({ server, url: `http://127.0.0.1:${address.port}` })
    })
  })
}

function startNext(port: number, supabaseUrl: string) {
  const child = spawn("npm", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
  })

  let output = ""
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Next dev server did not start:\n${output}`)), 60000)
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes("Ready in")) {
        clearTimeout(timer)
        resolve()
      }
    }
    child.stdout.on("data", onData)
    child.stderr.on("data", onData)
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(new Error(`Next dev server exited early with ${code}:\n${output}`))
    })
  })

  return { child, ready }
}

async function stop(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return
  child.kill("SIGINT")
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5000))])
  if (child.exitCode === null) child.kill("SIGKILL")
}

async function main() {
  const fakeSupabase = await startFakeSupabase()
  const port = 3200 + Math.floor(Math.random() * 1000)
  const next = startNext(port, fakeSupabase.url)
  await next.ready

  const browser = await chromium.launch()
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(err.message))
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text())
  })

  try {
    await page.goto(`http://127.0.0.1:${port}/login?next=%2Fadmin%2Ffinance`)
    await page.locator('input[name="email"]').fill(user.email)
    // Password login is maintenance-only behind a reveal toggle (UI baseline,
    // owner directive 2026-09-24) — open the fallback form first.
    await page.getByRole("button", { name: /บำรุงรักษา/ }).click()
    await page.locator('input[name="password"]').fill("test-password")
    await page.getByRole("button", { name: "เข้าสู่ระบบด้วยรหัสผ่าน" }).click()
    try {
      await page.waitForURL(`http://127.0.0.1:${port}/admin/finance`, { timeout: 30000 })
    } catch (error) {
      const bodyText = await page.locator("body").innerText().catch(() => "")
      throw new Error(`login did not reach /admin/finance; current=${page.url()}; body=${bodyText}`, { cause: error })
    }

    await page.getByText("งบการเงินจากข้อมูลที่ระบบมีจริง").waitFor({ timeout: 30000 })
    await page.getByText("กำไรขาดทุน", { exact: true }).waitFor()
    await page.getByText("กระแสเงินสด", { exact: true }).waitFor()
    await page.getByText("ฐานะการเงิน", { exact: true }).waitFor()
    // Render through the page's own th-TH formatter (may emit Thai digits) —
    // never hardcode a locale-specific string.
    const thbFmt = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    await page.locator("b").filter({ hasText: new RegExp(`^${esc(thbFmt(8000))} ฿$`) }).waitFor()
    await page.locator("b").filter({ hasText: new RegExp(`^${esc(thbFmt(5000))} ฿$`) }).waitFor()
    await page.locator("b").filter({ hasText: new RegExp(`^${esc(thbFmt(3000))} ฿$`) }).waitFor()

    const apiResponse = await page.request.get(`http://127.0.0.1:${port}/api/admin/finance-summary`)
    assert.equal(apiResponse.status(), 200)
    const api = await apiResponse.json()

    assert.equal(api.ok, true)
    assert.equal(api.financial_statements.profit_and_loss.revenue_documented, 10000)
    assert.equal(api.financial_statements.profit_and_loss.expenses_recorded, 2000)
    assert.equal(api.financial_statements.profit_and_loss.net_document_margin, 8000)
    assert.equal(api.financial_statements.cash_basis.cash_in_verified, 7000)
    assert.equal(api.financial_statements.cash_basis.cash_out_recorded, 2000)
    assert.equal(api.financial_statements.cash_basis.net_cash_movement, 5000)
    assert.equal(api.financial_statements.statement_of_financial_position.cash_verified, 7000)
    assert.equal(api.financial_statements.statement_of_financial_position.receivables_known, 3000)
    assert.equal(api.financial_statements.statement_of_financial_position.pending_verification_assets, 1200)
    assert.equal(api.financial_statements.statement_of_financial_position.liabilities_known, null)
    assert.equal(api.financial_statements.statement_of_financial_position.equity_known, null)
    assert.deepEqual(errors, [])

    console.log(`AUTH: PASS http://127.0.0.1:${port}/admin/finance`)
    console.log("API: PASS /api/admin/finance-summary returned financial_statements")
    console.log("UI: PASS rendered profit and loss, cash basis statement, limited statement of financial position")
    console.log("ACCOUNTING VALUES: PASS liabilities/equity stayed null; values derived from mock documents/receipts/debt/expenses")
    console.log("RUNTIME: PASS no browser console/page errors")
  } finally {
    await browser.close()
    fakeSupabase.server.close()
    await stop(next.child)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
