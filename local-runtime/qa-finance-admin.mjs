// Live QA walkthrough — UNIFIED FINANCE ADMIN (production, read-only interactions)
// node local-runtime/qa-finance-admin.mjs
import { chromium } from "playwright"
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"

const BASE = "https://dna-os-deadboard-production.up.railway.app"
const loginUrl = readFileSync(new URL("./qa-login.url", import.meta.url), "utf8").trim()
const OUT = decodeURIComponent(new URL("./qa-finance-admin/", import.meta.url).pathname)
mkdirSync(OUT, { recursive: true })

const consoleErrors = []
const consoleWarnings = []
const pageErrors = []
const failedRequests = []
const badResponses = []

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

page.on("console", (msg) => {
  const t = msg.type()
  if (t === "error") consoleErrors.push(msg.text().slice(0, 300))
  if (t === "warning") consoleWarnings.push(msg.text().slice(0, 200))
})
page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 300)))
page.on("requestfailed", (req) => failedRequests.push(`${req.method()} ${req.url().slice(0, 150)} :: ${req.failure()?.errorText}`))
page.on("response", (res) => {
  if (res.status() >= 400) badResponses.push(`${res.status()} ${res.request().method()} ${res.url().slice(0, 150)}`)
})

const results = []
const mark = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id} — ${detail}`) }

// log every API response from the very start (summary fetch fires on mount)
const apiLog = []
page.on("response", (res) => {
  const u = res.url()
  if (u.includes("/api/admin/")) apiLog.push(`${res.status()} ${u.split("/api/admin/")[1].split("?")[0]}`)
})

// 1) login via the system's own magic-link confirm endpoint
await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 60000 })
await page.waitForTimeout(1500)
const landed = page.url()
mark("T1-login", landed.includes("/admin/finance"), `landed: ${landed}`)

// 2) finance workspace visible + 6 tabs
const h1 = await page.locator("h1").first().textContent().catch(() => null)
const tabCount = await page.locator("button", { hasText: /ภาพรวม|บันทึกเงินเข้า|บันทึกเงินออก|รายการการเงิน|เอกสาร|ประวัติการดำเนินงาน/ }).count()
mark("T1-page", (h1 ?? "").includes("การเงิน"), `h1="${h1}"`)
mark("T2-tabs", tabCount >= 6, `tab buttons found: ${tabCount}`)

const clickTab = async (label) => {
  await page.locator("button", { hasText: label }).first().click()
  await page.waitForTimeout(1800)
}

// TAB 1 — ภาพรวม (fetch เกิดตอน mount — เช็คจาก apiLog ที่บันทึกตั้งแต่ก่อน goto)
const summaryLogged = apiLog.some((l) => l.startsWith("200 ") && l.includes("finance-summary"))
mark("T2-overview-api", summaryLogged, `finance-summary in apiLog: ${apiLog.filter((l) => l.includes("finance-summary"))}`)
const hasRevenueCard = await page.getByText("รายได้ (เอกสาร)").count()
mark("T2-overview-ui", hasRevenueCard > 0, "revenue card rendered")
await page.screenshot({ path: OUT + "1-overview.png", fullPage: true })

// TAB 2 — บันทึกเงินเข้า
const partnersPromise = page.waitForResponse((r) => r.url().includes("/api/admin/partners"), { timeout: 20000 }).catch(() => null)
await clickTab("บันทึกเงินเข้า")
const incomeForm = await page.getByText("บันทึกเป็นหลักฐานเงินเข้า (รอตรวจสอบ)").count()
mark("T3-income-form", incomeForm > 0, "income submit button present (not clicked)")
const banner = await page.getByText("การกดบันทึกเป็นการบันทึก").count()
mark("T3-income-banner", banner > 0, "save≠confirm banner present")
const partnersRes = await partnersPromise
const partnersJson = partnersRes?.status() === 200 ? await partnersRes.json().catch(() => null) : null
const partnersCount = partnersJson?.partners?.length ?? 0
mark("T4-partners-api", partnersRes?.status() === 200 && partnersCount > 0, `GET /api/admin/partners ${partnersRes?.status()} → ${partnersCount} companies from real DB`)
const firstSelect = page.locator("form select").first()
await firstSelect.click().catch(() => {})
await page.waitForTimeout(500)
const optionCount = await page.locator("form select option").count()
mark("T4-partners-options", optionCount > 1, `income company select shows ${optionCount} options`)
await page.keyboard.press("Escape").catch(() => {})
await page.screenshot({ path: OUT + "2-income.png", fullPage: true })

// TAB 3 — บันทึกเงินออก (+ payables panel API)
const payablesPromise = page.waitForResponse((r) => r.url().includes("/api/admin/payables"), { timeout: 20000 }).catch(() => null)
await clickTab("บันทึกเงินออก")
const expenseForm = await page.getByText("บันทึกรายจ่าย (Cost Ledger)").count()
mark("T3-expense-form", expenseForm > 0, "expense submit button present (not clicked)")
const payablesRes = await payablesPromise
mark("T3-payables-api", payablesRes?.status() === 200, `GET /api/admin/payables ${payablesRes?.status()}`)
const payablesLabel = await page.getByText("คำขอจ่ายเงินพาร์ตเนอร์").count()
mark("T3-payables-ui", payablesLabel > 0, "payables panel rendered")
await page.screenshot({ path: OUT + "3-expense.png", fullPage: true })

// TAB 4 — รายการการเงิน
const txPromise = page.waitForResponse((r) => r.url().includes("/api/admin/finance/transactions"), { timeout: 25000 }).catch(() => null)
await clickTab("รายการการเงิน")
const txRes = await txPromise
const txJson = txRes?.status() === 200 ? await txRes.json().catch(() => null) : null
const txRows = txJson?.items?.length ?? 0
mark("T5-unified-api", txRes?.status() === 200 && txRows > 0, `GET finance/transactions ${txRes?.status()} → ${txRows} rows merged`)
await page.waitForTimeout(1000)
const listUi = await page.getByText("ทิศทาง").count()
mark("T5-unified-ui", listUi > 0, "unified list filters rendered")
await page.screenshot({ path: OUT + "4-unified-list.png", fullPage: true })

// TAB 5 — เอกสาร
const docsPromise = page.waitForResponse((r) => r.url().includes("/api/admin/documents"), { timeout: 25000 }).catch(() => null)
await clickTab("เอกสาร")
const docsRes = await docsPromise
const docsJson = docsRes?.status() === 200 ? await docsRes.json().catch(() => null) : null
const docRows = docsJson?.documents?.length ?? 0
mark("T5-docs-api", docsRes?.status() === 200, `GET /api/admin/documents ${docsRes?.status()} → ${docRows} documents`)
const docsUi = await page.getByText("เปิดคลังเอกสารทั้งหมด").count()
mark("T5-docs-ui", docsUi > 0, "documents tab links rendered")
await page.screenshot({ path: OUT + "5-documents.png", fullPage: true })

// TAB 6 — ประวัติการดำเนินงาน
const auditPromise = page.waitForResponse((r) => r.url().includes("/api/admin/finance/audit"), { timeout: 20000 }).catch(() => null)
await clickTab("ประวัติการดำเนินงาน")
const auditRes = await auditPromise
const auditJson = auditRes?.status() === 200 ? await auditRes.json().catch(() => null) : null
const auditRows = auditJson?.items?.length ?? 0
mark("T5-audit-api", auditRes?.status() === 200, `GET finance/audit ${auditRes?.status()} → ${auditRows} audit rows`)
await page.screenshot({ path: OUT + "6-audit.png", fullPage: true })

// 6) console/network summary
mark("T6-console-errors", consoleErrors.length === 0, `${consoleErrors.length} console errors`)
mark("T6-page-errors", pageErrors.length === 0, `${pageErrors.length} page errors`)
mark("T6-bad-responses", badResponses.length === 0, `${badResponses.length} >=400 responses`)
mark("T6-failed-requests", failedRequests.length === 0, `${failedRequests.length} failed requests`)

writeFileSync(OUT + "report.json", JSON.stringify({ results, consoleErrors, consoleWarnings, pageErrors, failedRequests, badResponses }, null, 2))
console.log("\nconsole errors:", JSON.stringify(consoleErrors.slice(0, 5)))
console.log("bad responses:", JSON.stringify(badResponses.slice(0, 8)))
