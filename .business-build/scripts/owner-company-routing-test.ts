/**
 * Owner company-routing regression tests (owner business routing fix, 2026-10-11)
 * exact match / multiple / no-match / Thai variants / no AI Gateway / no DB mutation
 * Run: npx tsx --env-file=.env.local scripts/owner-company-routing-test.ts
 */
import { readFileSync } from "node:fs"
import { answerCompanyInfoQuestion } from "../cognitive/pipeline"

const calls: string[] = []

function makeDispatch(handlers: Record<string, () => { ok: boolean; data: unknown }>) {
  return async (command: string): Promise<{ ok: boolean; data: unknown; command: string; requires_confirmation: boolean; violations: string[] }> => {
    calls.push(command)
    const h = handlers[command]
    return { command, requires_confirmation: false, violations: [], ...(h ? h() : { ok: false, data: null }) }
  }
}

let pass = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`) }
  else { failures.push(name); console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`) }
}

const KT = { id: "aaaa1111-0000-0000-0000-000000000001", name: "บจก. เคที คอนสตรัคชั่น 1988 จำกัด" }
const KTCOMP = { ...KT, phone: "043-000-001", address: "ขอนแก่น", tax_id: "11111111111", partner_type_label: "CUSTOMER" }
const TL = { summary: {}, timeline: [{ date: "2026-05-03", title: "รับเงิน", amount: 10000, kind: "x", template_id: "x", template_key: "x", event_type: "payment", subtitle: null, status: null }] }
const single = makeDispatch({
  "partner.find": () => ({ ok: true, data: [KT] }),
  "partner.profile": () => ({ ok: true, data: KTCOMP }),
  "partner.timeline": () => ({ ok: true, data: TL }),
})

async function main() {
  // T1 exact single match + real data rendered
  calls.length = 0
  const t1 = await answerCompanyInfoQuestion("เปิดข้อมูลบริษัท บจก. เคที คอนสตรัคชั่น 1988 จำกัด", { dispatch: single })
  check("T1 exact match renders real profile+timeline",
    Boolean(t1 && t1.text.includes("เคที") && t1.text.includes("043-000-001") && t1.text.includes("รับเงิน") && t1.text.includes("10,000")),
    `calls=[${calls.join(",")}]`)

  // T2 multiple matches → selection list (never auto-pick)
  calls.length = 0
  const multi = makeDispatch({
    "partner.find": () => ({ ok: true, data: [{ id: "1", name: "หจก. เคที การช่าง" }, { id: "2", name: "บจก. เคที คอนสตรัคชั่น" }, { id: "3", name: "เคที ทรานสปอร์ต" }] }),
  })
  const t2 = await answerCompanyInfoQuestion("ดูบริษัท เคที", { dispatch: multi })
  check("T2 multiple matches → selection list", Boolean(t2 && t2.text.includes("พบ 3 ราย") && t2.text.includes("หจก. เคที การช่าง") && t2.text.includes("เคที ทรานสปอร์ต")))
  check("T2b multiple matches never calls profile/timeline", !calls.includes("partner.profile") && !calls.includes("partner.timeline"))

  // T3 no match → explicit not-found (not null, not AI)
  const none = makeDispatch({ "partner.find": () => ({ ok: true, data: [] }) })
  const t3 = await answerCompanyInfoQuestion("แสดงข้อมูลบริษัท บริษัทที่ไม่มีจริง จำกัด", { dispatch: none })
  check("T3 no match → explicit not-found", Boolean(t3 && t3.text.includes("ไม่พบ") && t3.text.includes("บริษัทที่ไม่มีจริง")))

  // T4 Thai variants (mission's exact phrasings) all route
  let allVariants = true
  for (const v of [
    "เปิดข้อมูลบริษัท ช.ธวัชชัยการช่าง",
    "ดูบริษัท ช.ธวัชชัยการช่าง",
    "แสดงข้อมูลบริษัท ช.ธวัชชัยการช่าง",
    "ข้อมูลบริษัท ช.ธวัชชัยการช่าง",
    "ดูคู่ค้า ช.ธวัชชัยการช่าง หน่อยครับ",
  ]) {
    const r = await answerCompanyInfoQuestion(v, { dispatch: single })
    if (!r || !r.text.includes("เคที")) { allVariants = false; console.log("   variant miss:", v) }
  }
  check("T4 Thai variants (5 phrasings) all resolve", allVariants)

  // T5 generic phrases NOT hijacked (stay on existing paths)
  for (const g of ["ดูบริษัททั้งหมด", "บริษัททั้งหมด", "เปิด LINE"]) {
    const r = await answerCompanyInfoQuestion(g, { dispatch: single })
    check(`T5 not hijacked: "${g}"`, r === null)
  }


  // T6 no AI Gateway invocation — static (function body never calls gateway)
  const src = readFileSync("cognitive/pipeline.ts", "utf8")
  const fn = src.slice(
    src.indexOf("export async function answerCompanyInfoQuestion"),
    src.indexOf("export async function runCognitivePipeline"),
  )
  check("T6a function body has no invokeAiGateway", !/invokeAiGateway/.test(fn))
  check("T6b function body uses only existing dispatcher readers",
    /partner\.find/.test(fn) && /partner\.profile/.test(fn) && /partner\.timeline/.test(fn))

  // T7 no database mutation — static
  check("T7 function body has no insert/update/delete", !/\.\s*(insert|update|delete|upsert)\s*\(/.test(fn))

  // T8 wiring: called in runCognitiveCore BEFORE the AI fallbacks
  const iCompany = src.indexOf("const companyAnswer = await answerCompanyInfoQuestion")
  const iClassify = src.indexOf("const aiAction = await classifyIntentViaAi")
  const iAnswer = src.indexOf("return answerWithAi(")
  check("T8 wired before classifyIntentViaAi + answerWithAi",
    iCompany > 0 && iCompany < iClassify && iCompany < iAnswer,
    `idx ${iCompany} < ${iClassify} < ${iAnswer}`)

  // T9 OpenAI disabled for owner command surface; other providers untouched
  const reg = JSON.parse(readFileSync("registry/ai-adapter-registry.json", "utf8"))
  const byId = Object.fromEntries(reg.adapters.map((a: { id: string; enabled: boolean }) => [a.id, a.enabled]))
  check("T9a openai disabled", byId.openai === false)
  check("T9b gemini/ollama/anthropic still enabled (unrelated services unaffected)",
    byId.gemini === true && byId.ollama === true && byId.anthropic === true)

  // T10 canonical writer baselines untouched by this change-set
  const census = readFileSync("scripts/connect-boundary-census-test.ts", "utf8")
  check("T10 census baseline constants unchanged",
    /DENO_BUSINESS_SITES:\s*24/.test(census) && /PAYMENT_AUTHORITIES:\s*1/.test(census))

  console.log(`\nRESULT: ${pass} passed, ${failures.length} failed`)
  if (failures.length > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
