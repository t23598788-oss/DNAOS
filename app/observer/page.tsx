/**
 * DNA OS — Architecture Observer
 *
 * หน้านี้เปิดให้ AI ภายนอก (Gemini, ChatGPT, Claude ฯลฯ) อ่านโครงสร้างระบบ
 * READ ONLY — ไม่มี DB query ไม่มีข้อมูลธุรกิจจริง
 * ข้อมูลทั้งหมดมาจากไฟล์ registry (static JSON) เท่านั้น
 */

import commandRegistry from "@/lib/registry/command-registry.json"
import moduleRegistry from "@/lib/registry/module-registry.json"
import businessCoverage from "@/lib/registry/business-coverage.json"
import documentRegistry from "@/08-document-registry.json"
import workflowRegistry from "@/07-workflow-registry.json"
import existence from "@/lib/registry/existence.json"

// ── static data ──

const LAYERS = [
  { id: "V1-Input",     path: "lib/v1-input/",    role: "รับ Event แปลงเป็น JSON — ห้ามเขียน DB" },
  { id: "V2-Rules",     path: "lib/v2-rules/",    role: "Validation + Business Rule + Command Dispatcher" },
  { id: "V3-Engines",   path: "lib/v3-engines/",  role: "คำนวณ business logic (ราคา, หนี้, ภาษี, timeline) — ห้าม hardcode" },
  { id: "V4-AI",        path: "lib/v4-ai/",       role: "แปลภาษาธรรมชาติ → command เท่านั้น ห้ามตัดสินใจ" },
  { id: "V5-Presenter", path: "lib/v5-presenter/",role: "จัด format ผลลัพธ์สำหรับแสดงผล — ห้าม import V3" },
  { id: "V6-Executor",  path: "lib/v6-executor/", role: "ประตูเดียวเขียน DB + ส่ง LINE + external services" },
  { id: "Cognitive",    path: "lib/cognitive/",   role: "Pipeline กลาง: Intent → Plan → Execute → Reflect" },
  { id: "Middleware",   path: "lib/middleware/",  role: "Auth (requireAuth) + Sanitize — ทุก API route บังคับใช้" },
]

const DB_TABLES = [
  { name: "partners",          desc: "คู่ค้า (ลูกค้า/ซัพพลายเออร์)", pk: "uuid", key_cols: "name, partner_type_label, phone, address, tax_id" },
  { name: "documents",         desc: "เอกสารทุกประเภท (invoice, receipt, DO, PO, QT ...)", pk: "uuid", key_cols: "document_type, document_number, status, partner_id, net_amount, issue_date, business_event_id" },
  { name: "document_items",    desc: "รายการย่อยในเอกสาร", pk: "uuid", key_cols: "document_id, line_no, description, qty, unit_price" },
  { name: "debt_trackings",    desc: "ติดตามลูกหนี้รายคน", pk: "uuid", key_cols: "partner_id, principal_amount, fee_rate, interest_start_at" },
  { name: "invoice_debts",     desc: "หนี้ค้างชำระจาก invoice (คนละตารางกับ debt_trackings)", pk: "uuid", key_cols: "document_id, invoice_status, outstanding_amount, paid_amount" },
  { name: "business_events",   desc: "เหตุการณ์ธุรกิจที่เกิดกับคู่ค้า (infrastructure สำหรับ Partner Timeline)", pk: "uuid", key_cols: "partner_id, event_type, event_date, title, metadata" },
  { name: "jobs",              desc: "งานจัดส่ง/โปรเจกต์", pk: "uuid", key_cols: "partner_id, job_status, distance_km, required_quantity" },
  { name: "line_events",       desc: "ข้อความ LINE ที่รับเข้าระบบ", pk: "uuid", key_cols: "event_type, group_id, message_id, raw_json" },
  { name: "line_draft_documents", desc: "ร่างเอกสารที่ AI วิเคราะห์จาก LINE รออนุมัติ", pk: "uuid", key_cols: "doc_type, status, payload" },
  { name: "app_configs",       desc: "ตั้งค่าระบบ (ค่า business rule ทุกตัวอยู่ที่นี่)", pk: "text (title)", key_cols: "title, data" },
  { name: "material_types",    desc: "ประเภทวัสดุ/สินค้า", pk: "uuid", key_cols: "name" },
]

const IRON_RULES = [
  "ห้าม hardcode ข้อมูลธุรกิจ — ทุกค่าจาก DB via app_configs",
  "ห้าม mock/fake/demo data ใน source code",
  "ทุก write ต้อง confirmed จากมนุษย์ (Rule 72)",
  "AI ห้ามเปลี่ยนสถานะการเงิน (Rule 73, 83)",
  "ทุก API route ต้องมี requireAuth",
  "ทุก Module ต้อง register ใน module-registry.json",
  "ทุก Command ต้อง register ใน command-registry.json",
  "Shadow Command (ไม่อยู่ใน registry) ถูกปฏิเสธเสมอ",
  "V2-V5 ห้าม import @supabase/supabase-js — เฉพาะ V6",
  "V5 ห้าม import จาก V3 โดยตรง",
]

// ── Section component ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-base font-bold text-stone-800 border-b border-stone-300 pb-1 mb-4">{title}</h2>
      {children}
    </section>
  )
}

function Tag({ children, color = "stone" }: { children: React.ReactNode; color?: "stone" | "blue" | "emerald" | "rose" | "amber" | "violet" }) {
  const cls = {
    stone:   "bg-stone-100 text-stone-600",
    blue:    "bg-blue-100 text-blue-700",
    emerald: "bg-emerald-100 text-emerald-700",
    rose:    "bg-rose-100 text-rose-700",
    amber:   "bg-amber-100 text-amber-700",
    violet:  "bg-violet-100 text-violet-700",
  }[color]
  return <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${cls} mr-1 mb-1`}>{children}</span>
}

// ── Main ──

export default function ObserverPage() {
  const commands = Object.entries(commandRegistry.commands).filter(([k]) => !k.startsWith("_"))
  const domains  = Object.entries(businessCoverage.domains)
  const docs     = Object.entries(documentRegistry.documents)
  const workflows = Object.entries(workflowRegistry.workflows)
  const modules  = Object.entries(moduleRegistry.modules).filter(([k]) => !k.startsWith("_"))

  return (
    <div className="min-h-screen bg-stone-50 font-mono text-stone-800">
      <div className="max-w-4xl mx-auto px-6 py-10">

          {/* ── Banner ── */}
          <div className="mb-10 border-2 border-sky-400 rounded-2xl p-5 bg-sky-50">
            <div className="flex items-start gap-4">
              <div className="text-3xl">🔭</div>
              <div>
                <div className="font-bold text-sky-800 text-lg">DNA OS — Architecture Observer</div>
                <div className="text-xs text-sky-700 mt-1">
                  READ ONLY · ไม่มีข้อมูลธุรกิจจริง · ข้อมูลทั้งหมดมาจาก static registry files
                </div>
                <div className="text-xs text-sky-600 mt-2 leading-relaxed">
                  หน้านี้สร้างขึ้นสำหรับ AI ภายนอก (Gemini, ChatGPT, Claude ฯลฯ) เพื่อเข้าใจโครงสร้างระบบ DNA OS<br />
                  ท่านสามารถวิเคราะห์และให้คำแนะนำเกี่ยวกับระบบนี้ได้ แต่ไม่สามารถส่งคำสั่งหรือแก้ไขข้อมูลได้ผ่านหน้านี้
                </div>
              </div>
            </div>
          </div>

          {/* ── Identity ── */}
          <Section title="🧬 ระบบคืออะไร">
            <div className="text-sm text-stone-700 space-y-2 leading-relaxed">
              <p><strong>DNA OS</strong> — ระบบ ERP อัจฉริยะสำหรับธุรกิจคอนกรีต/ขนส่ง</p>
              <p><strong>หลักการ:</strong> AI เป็นแค่ตัวกลาง ไม่ใช่ศูนย์กลาง — ศูนย์กลางคือกฎและสถาปัตยกรรม</p>
              <p><strong>การเติบโต:</strong> ขยายจากคลังกฎและ Workflow ไม่ใช่จากการฝึก AI</p>
              <p><strong>Design Shift (2026-07):</strong> เปลี่ยนจาก "เอกสารเป็นศูนย์กลาง" → <strong>"ความสัมพันธ์และ Event เป็นศูนย์กลาง"</strong></p>
              <p className="text-stone-500 text-xs">Partner → Timeline of Events → Documents (เอกสารคือ artifact ของ event ไม่ใช่ตัว event เอง)</p>
            </div>
          </Section>

          {/* ── Architecture Pipeline ── */}
          <Section title="🏗️ สถาปัตยกรรม V1–V6 Pipeline">
            <div className="space-y-1.5">
              {LAYERS.map((l) => (
                <div key={l.id} className="flex gap-3 text-xs">
                  <span className="font-mono font-bold text-violet-700 w-28 shrink-0">{l.id}</span>
                  <span className="text-stone-400 w-44 shrink-0">{l.path}</span>
                  <span className="text-stone-600">{l.role}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 text-xs text-stone-500 bg-stone-100 rounded-xl p-3 font-mono">
              User → V4-AI → V2-Rules (Dispatcher) → V3-Engines → V6-Executor → DB<br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↑ ตรวจ registry + filter ทุก command
            </div>
          </Section>

          {/* ── Database Tables ── */}
          <Section title="🗄️ โครงสร้างฐานข้อมูล">
            <div className="space-y-2">
              {DB_TABLES.map((t) => (
                <div key={t.name} className="border border-stone-200 rounded-xl px-4 py-2.5 bg-white">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-stone-800 text-xs">{t.name}</span>
                    <span className="text-[10px] text-stone-400">pk: {t.pk}</span>
                  </div>
                  <div className="text-xs text-stone-500 mt-0.5">{t.desc}</div>
                  <div className="text-[10px] text-stone-400 mt-1 font-mono">{t.key_cols}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Document Types ── */}
          <Section title="📄 ประเภทเอกสาร">
            <div className="grid grid-cols-2 gap-2">
              {docs.map(([key, val]) => (
                <div key={key} className="border border-stone-200 rounded-xl px-3 py-2 bg-white">
                  <div className="font-mono font-bold text-xs text-stone-700">{key}</div>
                  <div className="text-xs text-stone-500">{(val as any).name_th} · prefix: {(val as any).prefix}</div>
                </div>
              ))}
              {/* types not in 08-registry but registered in system */}
              {[
                { key: "purchase_order", th: "ใบสั่งซื้อ", prefix: "PO" },
                { key: "payment_voucher", th: "ใบสำคัญจ่าย", prefix: "PV" },
                { key: "debt_notice", th: "ใบทวงหนี้", prefix: "DN" },
              ].map((t) => (
                <div key={t.key} className="border border-stone-200 rounded-xl px-3 py-2 bg-white">
                  <div className="font-mono font-bold text-xs text-stone-700">{t.key}</div>
                  <div className="text-xs text-stone-500">{t.th} · prefix: {t.prefix}</div>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Commands ── */}
          <Section title="⚙️ Command Registry (ทุก command ที่ระบบรู้จัก)">
            <div className="space-y-1.5">
              {commands.map(([name, def]) => {
                const d = def as any
                return (
                  <div key={name} className="flex items-start gap-3 text-xs border-b border-stone-100 pb-1.5">
                    <span className="font-mono font-bold text-stone-700 w-40 shrink-0">{name}</span>
                    <span className="text-stone-500 flex-1">{d.description_th ?? d.description ?? ""}</span>
                    <div className="flex gap-1 shrink-0">
                      {d.requires_confirmation && <Tag color="rose">confirm</Tag>}
                      {d.status === "stub" && <Tag color="amber">stub</Tag>}
                      <Tag color="stone">{d.layer}</Tag>
                    </div>
                  </div>
                )
              })}
            </div>
          </Section>

          {/* ── Business Domains ── */}
          <Section title="🏢 Business Coverage">
            <div className="space-y-3">
              {domains.map(([key, val]) => {
                const d = val as any
                return (
                  <div key={key} className={`border rounded-xl px-4 py-3 ${d.status === "covered" ? "border-emerald-200 bg-emerald-50" : d.status === "partial" ? "border-amber-200 bg-amber-50" : "border-stone-200 bg-stone-50"}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-stone-700">{d.label}</span>
                      <Tag color={d.status === "covered" ? "emerald" : d.status === "partial" ? "amber" : "stone"}>
                        {d.status}
                      </Tag>
                    </div>
                    {d.commands?.length > 0 && (
                      <div className="text-[10px] text-stone-500 mt-1">Commands: {d.commands.join(", ")}</div>
                    )}
                    {d.gap && (
                      <div className="text-[10px] text-amber-700 mt-1">Gap: {d.gap}</div>
                    )}
                    {d.design_principle && (
                      <div className="text-[10px] text-emerald-700 mt-1">Design: {d.design_principle}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </Section>

          {/* ── Workflows ── */}
          <Section title="🔄 Workflow Registry">
            <div className="space-y-3">
              {workflows.map(([key, val]) => {
                const w = val as any
                return (
                  <div key={key} className="border border-stone-200 rounded-xl px-4 py-3 bg-white">
                    <div className="font-bold text-xs text-stone-700">{w.name}</div>
                    <div className="text-xs text-stone-500 mt-0.5">{w.description_th}</div>
                    <div className="text-[10px] text-stone-400 mt-1">Trigger: {w.trigger_th}</div>
                    {w.steps_th && (
                      <div className="text-[10px] text-stone-400 mt-1">Steps: {(w.steps_th as string[]).join(" → ")}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </Section>

          {/* ── Capabilities ── */}
          <Section title="⚡ ความสามารถระบบ (Existence Registry)">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries((existence as any).capabilities ?? {}).map(([cap, val]) => {
                const v = val as any
                return (
                  <div key={cap} className="border border-stone-200 rounded-xl px-3 py-2 bg-white">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs text-stone-700">{cap}</span>
                      <Tag color={v.status === "available" ? "emerald" : "stone"}>
                        {v.status}
                      </Tag>
                    </div>
                    {v.interfaces?.length > 0 && (
                      <div className="text-[10px] text-stone-400 mt-1">{v.interfaces.join(", ")}</div>
                    )}
                    {v.gap && <div className="text-[10px] text-amber-600 mt-0.5">{v.gap}</div>}
                  </div>
                )
              })}
            </div>
          </Section>

          {/* ── Iron Rules ── */}
          <Section title="⚖️ กฎเหล็ก (Constitution)">
            <ul className="space-y-1.5">
              {IRON_RULES.map((rule, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-stone-700">
                  <span className="text-rose-500 font-bold shrink-0">{i + 1}.</span>
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </Section>

          {/* ── Module Count ── */}
          <Section title="📦 Module Registry (สรุป)">
            <div className="flex flex-wrap gap-2 text-xs">
              {["shared", "api", "ui", "v2-rules", "v3-engines", "v4-ai", "v5-presenter", "v6-executor", "cognitive", "registry", "runtime"].map((layer) => {
                const count = modules.filter(([, m]) => (m as any).layer === layer).length
                if (count === 0) return null
                return (
                  <div key={layer} className="border border-stone-200 rounded-xl px-3 py-1.5 bg-white">
                    <span className="font-mono font-bold text-stone-600">{layer}</span>
                    <span className="ml-2 text-stone-400">{count} modules</span>
                  </div>
                )
              })}
            </div>
          </Section>

          {/* ── External AI API Pipe ── */}
          <Section title="🔌 ท่อเชื่อม AI ภายนอก (External AI Pipe)">
            <div className="space-y-4">
              <div className="text-xs text-stone-700 leading-relaxed">
                DNA OS เปิด API ให้ AI ภายนอก (Gemini, ChatGPT, Claude, หรือ app ใดก็ได้) เรียก query commands ผ่าน token
              </div>

              {/* Step guide */}
              <div className="space-y-2">
                {[
                  { step: "1", title: "อ่านโครงสร้างระบบ", desc: "วาง URL หน้า Observer (/observer) ลงในแชท AI เพื่อให้รู้ว่า DNA OS มีอะไรบ้าง", tag: "READ ONLY · ไม่ต้อง token" },
                  { step: "2", title: "ดึง Tool Spec", desc: "GET /api/v1/spec — ได้รายการ commands ทั้งหมดในรูปแบบ OpenAI function-calling", tag: "Public · Cache 5 min" },
                  { step: "3", title: "สร้าง Token", desc: "ไปที่ /admin/api-tokens → สร้าง token ผูกกับอีเมลของท่าน", tag: "ต้อง login" },
                  { step: "4", title: "เรียก Query", desc: "POST /api/v1/query  +  Header: X-DNA-Token: <token>  +  Body: {command, args}", tag: "Read-only commands เท่านั้น" },
                ].map(({ step, title, desc, tag }) => (
                  <div key={step} className="flex gap-3 bg-stone-50 rounded-xl p-3 border border-stone-200">
                    <div className="w-6 h-6 rounded-full bg-sky-500 text-white text-[11px] font-bold flex items-center justify-center shrink-0">{step}</div>
                    <div>
                      <div className="text-xs font-bold text-stone-800">{title}</div>
                      <div className="text-xs text-stone-500 mt-0.5">{desc}</div>
                      <div className="text-[10px] mt-1 font-mono bg-stone-100 px-2 py-0.5 rounded-full inline-block text-stone-500">{tag}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Request example */}
              <div>
                <div className="text-[10px] font-semibold text-stone-500 uppercase mb-2">ตัวอย่าง request</div>
                <pre className="text-[10px] bg-stone-900 text-stone-100 rounded-xl p-4 overflow-x-auto leading-relaxed">{`POST /api/v1/query
X-DNA-Token: your-token-here
Content-Type: application/json

{ "command": "debt.list", "args": {} }

// Response
{
  "ok": true,
  "command": "debt.list",
  "user": "your@email.com",
  "data": [ ...InvoiceDebt[] ]
}`}</pre>
              </div>

              {/* Guard notes */}
              <div className="border border-rose-200 bg-rose-50 rounded-xl p-3 space-y-1">
                <div className="text-xs font-bold text-rose-700">ข้อจำกัด (Guard)</div>
                <ul className="text-xs text-rose-600 space-y-0.5 list-none">
                  <li>• Write commands (requires_confirmation: true) ถูกบล็อก — ต้องทำจาก /admin UI เท่านั้น (Rule 72)</li>
                  <li>• Shadow Command (ไม่อยู่ใน registry) ถูกปฏิเสธเสมอ</li>
                  <li>• Token ผูกกับ user_email — revoke ได้ทันทีจาก /admin/api-tokens</li>
                  <li>• ข้อมูลจริงของธุรกิจ: อ่านได้ผ่าน token เท่านั้น ไม่ผ่านหน้า Observer นี้</li>
                </ul>
              </div>
            </div>
          </Section>

          {/* ── Footer ── */}
          <div className="border-t border-stone-200 pt-6 text-center text-[10px] text-stone-400 space-y-1">
            <div>DNA OS · Architecture Observer · READ ONLY</div>
            <div>ข้อมูลนี้มาจาก static registry files เท่านั้น ไม่มีการเชื่อมต่อฐานข้อมูล</div>
            <div>ต้องการ query ข้อมูลจริง → ใช้ /api/v1/query พร้อม token จาก /admin/api-tokens</div>
          </div>

        </div>
      </div>
  )
}
