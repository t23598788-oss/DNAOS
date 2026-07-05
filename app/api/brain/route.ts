import { NextResponse } from "next/server"
import OpenAI from "openai"
import { supabase } from "@/lib/supabase/queries"

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// ── DNA OS system context ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are DNA Brain — the intelligent assistant embedded inside DNA OS, a Thai business ERP system.

DNA OS manages: partners (customers & suppliers), jobs/transactions (sale, purchase, contract, service, rental, transport), documents (invoices, receipts, purchase orders, delivery orders, payment vouchers, debt notices), business events, and debt tracking.

Rules:
- Always answer in the SAME LANGUAGE the user writes in. Thai → Thai. English → English. Mixed → match the majority.
- Only state facts you retrieved from the database tools. Never invent numbers.
- When you find data, be specific: names, amounts, dates, statuses.
- If no data matches, say so clearly.
- Keep answers concise. Use bullet points for lists.
- Format financial figures with commas (e.g. ฿1,250,000).
- Transaction states: draft → confirmed → in_progress → completed → closed / cancelled.
- Always use tools to fetch real data before answering questions about partners, jobs, debts, or finances.`

// ── Tool definitions ───────────────────────────────────────────────────────
const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "query_partners",
      description: "Search or list business partners (customers and suppliers). Use when user asks about a company, person, or wants a partner list.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Name or keyword to search. Empty = list all." },
          limit: { type: "number", description: "Max results. Default 10." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_jobs",
      description: "List jobs/transactions. Use for questions about ongoing work, pending jobs, sales, purchases.",
      parameters: {
        type: "object",
        properties: {
          tx_type: { type: "string", enum: ["sale", "purchase", "contract", "service", "rental", "transport"] },
          state: { type: "string", description: "draft, confirmed, in_progress, completed, closed, cancelled" },
          limit: { type: "number", description: "Max results. Default 10." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_debts",
      description: "List open debt tracking records. Use for questions about unpaid debts, outstanding balances.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results. Default 10." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_documents",
      description: "Search documents or get counts by type: invoice, receipt, purchase_order, delivery_order, payment_voucher, debt_notice.",
      parameters: {
        type: "object",
        properties: {
          document_type: { type: "string" },
          search: { type: "string", description: "Search by doc number" },
          limit: { type: "number", description: "Max results. Default 10." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_financial_summary",
      description: "Get overall financial summary: total invoiced, received, outstanding, job counts. Use for dashboard-style questions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_partner_detail",
      description: "Get full details for one specific partner: jobs, financials, debts. Use when user asks about a specific company by name.",
      parameters: {
        type: "object",
        required: ["partner_name"],
        properties: {
          partner_name: { type: "string", description: "Partner name to look up" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_events",
      description: "List recent business events and activities in the system.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max results. Default 15." },
        },
      },
    },
  },
]

// ── Tool implementations ───────────────────────────────────────────────────
async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "query_partners": {
        let q = supabase()
          .from("partners")
          .select("id, name, type, tax_id, phone, created_at")
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit((args.limit as number) ?? 10)
        if (args.search) q = q.ilike("name", `%${args.search}%`)
        const { data, error } = await q
        if (error) return `Error: ${error.message}`
        if (!data?.length) return "ไม่พบพาร์ตเนอร์ที่ตรงกัน"
        return JSON.stringify(data.map(p => ({
          id: p.id, name: p.name, type: p.type, tax_id: p.tax_id, phone: p.phone,
        })))
      }

      case "query_jobs": {
        let q = supabase()
          .from("transactions")
          .select(`id, tx_type, state, net_amount, paid_amount, project_name, created_at, state_changed_at,
            partners!transactions_partner_id_fkey(name)`)
          .is("deleted_at", null)
          .order("state_changed_at", { ascending: false })
          .limit((args.limit as number) ?? 10)
        if (args.tx_type) q = q.eq("tx_type", args.tx_type as string)
        if (args.state) q = q.eq("state", args.state as string)
        const { data, error } = await q
        if (error) return `Error: ${error.message}`
        if (!data?.length) return "ไม่พบงานที่ตรงกัน"
        return JSON.stringify((data as any[]).map(t => ({
          id: t.id,
          type: t.tx_type,
          state: t.state,
          project: t.project_name,
          partner: t.partners?.name,
          net_amount: t.net_amount,
          paid_amount: t.paid_amount,
          outstanding: (Number(t.net_amount ?? 0) - Number(t.paid_amount ?? 0)).toFixed(2),
          date: t.state_changed_at ?? t.created_at,
        })))
      }

      case "query_debts": {
        const { data, error } = await supabase()
          .from("debt_trackings")
          .select(`id, principal_amount, fee_rate, interest_start_at, status, created_at,
            partners!debt_trackings_partner_id_fkey(name)`)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit((args.limit as number) ?? 10)
        if (error) return `Error: ${error.message}`
        if (!data?.length) return "ไม่มีรายการหนี้ค้างชำระ"
        return JSON.stringify((data as any[]).map(d => ({
          id: d.id,
          partner: d.partners?.name ?? "ไม่ระบุ",
          principal: d.principal_amount,
          fee_rate: d.fee_rate,
          since: d.interest_start_at,
          status: d.status,
        })))
      }

      case "query_documents": {
        let q = supabase()
          .from("documents")
          .select(`id, document_type, doc_number, net_amount, status, issue_date,
            partners!documents_partner_id_fkey(name)`)
          .is("deleted_at", null)
          .order("issue_date", { ascending: false })
          .limit((args.limit as number) ?? 10)
        if (args.document_type) q = q.eq("document_type", args.document_type as string)
        if (args.search) q = q.ilike("doc_number", `%${args.search}%`)
        const { data, error } = await q
        if (error) return `Error: ${error.message}`
        if (!data?.length) return "ไม่พบเอกสาร"
        return JSON.stringify((data as any[]).map(d => ({
          id: d.id,
          type: d.document_type,
          number: d.doc_number,
          partner: d.partners?.name,
          amount: d.net_amount,
          status: d.status,
          date: d.issue_date,
        })))
      }

      case "query_financial_summary": {
        const [invRes, recRes, debtRes, txRes] = await Promise.all([
          supabase().from("documents").select("net_amount").eq("document_type", "invoice").is("deleted_at", null),
          supabase().from("documents").select("net_amount").eq("document_type", "receipt").is("deleted_at", null),
          supabase().from("debt_trackings").select("principal_amount").is("deleted_at", null),
          supabase().from("transactions").select("state, net_amount, paid_amount").is("deleted_at", null),
        ])
        const totalInvoiced = (invRes.data ?? []).reduce((s, d) => s + Number(d.net_amount ?? 0), 0)
        const totalReceived = (recRes.data ?? []).reduce((s, d) => s + Number(d.net_amount ?? 0), 0)
        const totalDebt = (debtRes.data ?? []).reduce((s, d) => s + Number(d.principal_amount ?? 0), 0)
        const txs = txRes.data ?? []
        const openJobs = txs.filter(t => !["closed", "cancelled", "completed"].includes(t.state ?? "")).length
        return JSON.stringify({
          total_invoiced: totalInvoiced,
          total_received: totalReceived,
          outstanding: totalInvoiced - totalReceived,
          total_debt_tracking: totalDebt,
          invoice_count: invRes.data?.length ?? 0,
          receipt_count: recRes.data?.length ?? 0,
          total_jobs: txs.length,
          open_jobs: openJobs,
        })
      }

      case "get_partner_detail": {
        const { data: partners } = await supabase()
          .from("partners")
          .select("id, name, type, tax_id, phone")
          .ilike("name", `%${args.partner_name}%`)
          .is("deleted_at", null)
          .limit(1)
        if (!partners?.length) return `ไม่พบพาร์ตเนอร์ชื่อ "${args.partner_name}"`
        const partner = partners[0]
        const [txRes, docRes, debtRes] = await Promise.all([
          supabase().from("transactions").select("id, tx_type, state, net_amount, paid_amount").eq("partner_id", partner.id).is("deleted_at", null),
          supabase().from("documents").select("document_type, net_amount").eq("partner_id", partner.id).is("deleted_at", null),
          supabase().from("debt_trackings").select("principal_amount, status").eq("partner_id", partner.id).is("deleted_at", null),
        ])
        const txs = txRes.data ?? []
        const docs = docRes.data ?? []
        const debts = debtRes.data ?? []
        const totalInvoiced = docs.filter(d => d.document_type === "invoice").reduce((s, d) => s + Number(d.net_amount ?? 0), 0)
        const totalReceived = docs.filter(d => d.document_type === "receipt").reduce((s, d) => s + Number(d.net_amount ?? 0), 0)
        return JSON.stringify({
          partner: { id: partner.id, name: partner.name, type: partner.type, tax_id: partner.tax_id },
          total_jobs: txs.length,
          open_jobs: txs.filter(t => !["closed", "cancelled"].includes(t.state ?? "")).length,
          total_invoiced: totalInvoiced,
          total_received: totalReceived,
          outstanding: totalInvoiced - totalReceived,
          open_debts: debts.filter(d => d.status !== "closed").length,
          total_debt: debts.reduce((s, d) => s + Number(d.principal_amount ?? 0), 0),
        })
      }

      case "query_events": {
        const { data, error } = await supabase()
          .from("business_events")
          .select(`id, event_type, description, created_at,
            partners!business_events_partner_id_fkey(name)`)
          .order("created_at", { ascending: false })
          .limit((args.limit as number) ?? 15)
        if (error) return `Error: ${error.message}`
        if (!data?.length) return "ไม่มีเหตุการณ์ล่าสุด"
        return JSON.stringify((data as any[]).map(e => ({
          type: e.event_type,
          description: e.description,
          partner: e.partners?.name,
          date: e.created_at,
        })))
      }

      default:
        return "Unknown tool"
    }
  } catch (err) {
    return `Tool error: ${err instanceof Error ? err.message : String(err)}`
  }
}

// ── API route ──────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    const { question, history: msgHistory } = await request.json()
    const q = String(question ?? "").trim()
    if (!q) return NextResponse.json({ answer: "พิมพ์คำถามมาก่อนครับ", matched: false }, { status: 400 })

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ answer: "ยังไม่ได้ตั้งค่า OPENAI_API_KEY ใน environment", matched: false })
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
    ]

    // เพิ่มประวัติการสนทนา (6 รอบล่าสุด)
    if (Array.isArray(msgHistory)) {
      for (const ex of (msgHistory as any[]).slice(-6)) {
        if (ex.question) messages.push({ role: "user", content: ex.question })
        if (ex.answer) messages.push({ role: "assistant", content: ex.answer })
      }
    }
    messages.push({ role: "user", content: q })

    // Agentic loop: AI เรียก tools จนได้คำตอบ
    let response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 1200,
    })

    let iterations = 0
    while (response.choices[0]?.finish_reason === "tool_calls" && iterations < 5) {
      iterations++
      const msg = response.choices[0].message
      messages.push(msg)

      const toolResults: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = []
      for (const call of msg.tool_calls ?? []) {
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(call.function.arguments) } catch { /* empty */ }
        const result = await runTool(call.function.name, args)
        toolResults.push({ role: "tool", tool_call_id: call.id, content: result })
      }
      messages.push(...toolResults)

      response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.3,
        max_tokens: 1200,
      })
    }

    const answer = response.choices[0]?.message?.content ?? "ไม่สามารถตอบได้ในขณะนี้"
    return NextResponse.json({ answer, matched: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ answer: `ผิดพลาด: ${msg}`, matched: false }, { status: 500 })
  }
}
