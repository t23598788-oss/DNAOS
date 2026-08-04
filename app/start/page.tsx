/**
 * /start — DNA OS Engineering Workspace (Main Domain UI Operational
 * Conversion, owner, 2026-08-04). Same route, same cards, same hrefs — only
 * the framing changed from "Developer Portal" to "Engineering Workspace",
 * and the 3 existing groups were relabeled Inspect/Build/Test to match what
 * each actually does (Learn's cards are all read-only inspection tools).
 * Nothing here was removed — Observer, JSON registries, API spec, and
 * Playground are real tools, not marketing content.
 */

import Link from "next/link"
import commandRegistry from "@/registry/command-registry.json"
import moduleRegistry  from "@/registry/module-registry.json"
import driversRegistry from "@/registry/drivers.json"
import workflowRegistry from "@/07-workflow-registry.json"

// ── Live counts from registries ──
const MODULE_COUNT   = Object.keys(moduleRegistry.modules).filter(k => !k.startsWith("_")).length
const COMMAND_COUNT  = Object.keys(commandRegistry.commands).filter(k => !k.startsWith("_")).length
const DRIVER_COUNT   = Object.keys(driversRegistry.drivers).length
const WORKFLOW_COUNT = Object.keys((workflowRegistry as any).workflows ?? {}).length

// ── Data ──

const GROUPS = [
  {
    label: "Inspect",
    sublabel: "เรียนรู้โครงสร้างระบบ",
    cards: [
      {
        title: "Observer",
        subtitle: "For AI",
        description: "วาง URL นี้ใน Gemini, ChatGPT, Claude หรือ AI ใดก็ได้ เพื่ออ่านโครงสร้างระบบทั้งหมด",
        href: "/observer",
        cta: "เปิด Observer",
        color: "sky",
        badge: "READ ONLY",
      },
      {
        title: "Machine Snapshot",
        subtitle: "For AI · Full JSON",
        description: "observer.json — สรุปโครงสร้างทั้งระบบในไฟล์เดียว พร้อม _links ไปยัง sub-registries",
        href: "/observer.json",
        cta: "เปิด observer.json",
        color: "stone",
        badge: "JSON",
      },
    ],
  },
  {
    label: "Build",
    sublabel: "เริ่มพัฒนาบน DNA OS",
    cards: [
      {
        title: "API Specification",
        subtitle: "For Developers & AI",
        description: "Tool spec ในรูปแบบ OpenAI function-calling — โหลดแล้วรู้ว่า DNA OS มี command อะไรบ้าง",
        href: "/api/v1/spec",
        cta: "ดู API Spec",
        color: "violet",
        badge: "JSON",
      },
      {
        title: "System Knowledge",
        subtitle: "For Developers",
        description: "ทุก Registry ของระบบ — Modules, Commands, Workflows, Constitution, Capabilities, Drivers",
        href: "/start#knowledge",
        cta: "ดู System Knowledge",
        color: "amber",
        badge: "JSON",
      },
      {
        title: "Screen Examples",
        subtitle: "For UI Designers",
        description: "แต่ละหน้าจอต้องใช้ command อะไร — เริ่มออกแบบได้ทันทีโดยไม่ต้องอ่าน source code",
        href: "/examples",
        cta: "ดู Examples",
        color: "emerald",
        badge: "GUIDE",
      },
    ],
  },
  {
    label: "Test",
    sublabel: "ทดลองเรียก API จริง",
    cards: [
      {
        title: "API Playground",
        subtitle: "For Developers",
        description: "ทดลองเรียก command ผ่านเบราว์เซอร์ ดูผลลัพธ์จริงจาก DNA OS โดยใช้ token ของท่าน",
        href: "/playground",
        cta: "เปิด Playground",
        color: "rose",
        badge: "LIVE",
      },
    ],
  },
]

const KNOWLEDGE_LINKS = [
  { label: "Commands",     href: "/api/v1/spec",         desc: `${COMMAND_COUNT} commands — OpenAI function-calling format` },
  { label: "Modules",      href: "/api/v1/modules",      desc: `${MODULE_COUNT} modules across all layers` },
  { label: "Workflows",    href: "/api/v1/workflows",    desc: `${WORKFLOW_COUNT} workflows — trigger + steps` },
  { label: "Constitution", href: "/api/v1/constitution", desc: "Iron Rules + design principles" },
  { label: "Capabilities", href: "/api/v1/capabilities", desc: "สิ่งที่ระบบทำได้และยังทำไม่ได้" },
  { label: "Drivers",      href: "/api/v1/drivers",      desc: `${DRIVER_COUNT} drivers — hardware & platform connectors` },
]

const PIPELINE = [
  { verb: "Input",     layer: "Input Gateway",     note: "รับ Event ทุกรูปแบบ (LINE, HTTP, Webhook)" },
  { verb: "Interpret", layer: "AI Interpreter",    note: "แปลภาษาธรรมชาติ → command" },
  { verb: "Validate",  layer: "Business Rules",    note: "Dispatcher + ตรวจ registry + กฎ" },
  { verb: "Calculate", layer: "Business Engine",   note: "คำนวณ logic ราคา / หนี้ / timeline" },
  { verb: "Execute",   layer: "Execution Layer",   note: "เขียน DB + LINE + external services" },
]

const COLOR_MAP: Record<string, string> = {
  sky:     "border-sky-200 bg-sky-50 hover:bg-sky-100",
  violet:  "border-violet-200 bg-violet-50 hover:bg-violet-100",
  amber:   "border-amber-200 bg-amber-50 hover:bg-amber-100",
  emerald: "border-emerald-200 bg-emerald-50 hover:bg-emerald-100",
  rose:    "border-rose-200 bg-rose-50 hover:bg-rose-100",
  stone:   "border-stone-200 bg-stone-50 hover:bg-stone-100",
}

const BADGE_COLOR: Record<string, string> = {
  sky:     "bg-sky-200 text-sky-700",
  violet:  "bg-violet-200 text-violet-700",
  amber:   "bg-amber-200 text-amber-700",
  emerald: "bg-emerald-200 text-emerald-700",
  rose:    "bg-rose-200 text-rose-700",
  stone:   "bg-stone-200 text-stone-600",
}

const GROUP_LABEL_COLOR: Record<string, string> = {
  Inspect: "text-sky-700 border-sky-200",
  Build: "text-violet-700 border-violet-200",
  Test:  "text-rose-700 border-rose-200",
}

export default function StartPage() {
  return (
    <div className="min-h-screen bg-stone-50 font-sans text-stone-800">
      <div className="max-w-5xl mx-auto px-6 py-12">

        {/* ── Header ── */}
        <div className="mb-10">
          <div className="text-[10px] font-mono text-stone-400 uppercase tracking-widest mb-2">Engineering Workspace</div>
          <h1 className="text-3xl font-bold text-stone-900 mb-1">DNA OS</h1>
          <p className="text-stone-400 text-sm mb-6">
            Registry-Driven ERP Platform — Architecture, Business Rules, Registry, and API in one place
          </p>

          {/* ── Stats bar ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-px bg-stone-200 rounded-2xl overflow-hidden border border-stone-200">
            {[
              { label: "Version",      value: "2.0" },
              { label: "Architecture", value: "Event-Centric" },
              { label: "Modules",      value: String(MODULE_COUNT) },
              { label: "Commands",     value: String(COMMAND_COUNT) },
              { label: "Workflows",    value: String(WORKFLOW_COUNT) },
              { label: "Drivers",      value: String(DRIVER_COUNT) },
              { label: "Observer",     value: "Ready" },
            ].map(({ label, value }) => (
              <div key={label} className="bg-white px-4 py-3">
                <div className="text-[10px] text-stone-400 font-mono uppercase">{label}</div>
                <div className="text-sm font-bold text-stone-800 mt-0.5 tabular-nums">{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Grouped Cards ── */}
        <div className="space-y-10 mb-14">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <div className="flex items-baseline gap-3 mb-4">
                <span className={`text-xs font-bold font-mono uppercase border px-2 py-0.5 rounded-full ${GROUP_LABEL_COLOR[g.label] ?? "text-stone-500 border-stone-200"}`}>
                  {g.label}
                </span>
                <span className="text-xs text-stone-400">{g.sublabel}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {g.cards.map((c) => (
                  <Link
                    key={c.href}
                    href={c.href}
                    className={`group border rounded-2xl p-5 transition flex flex-col gap-3 ${COLOR_MAP[c.color]}`}
                  >
                    <div className="flex items-start justify-between">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full font-mono ${BADGE_COLOR[c.color]}`}>
                        {c.badge}
                      </span>
                    </div>
                    <div>
                      <div className="font-bold text-stone-900">{c.title}</div>
                      <div className="text-[11px] text-stone-500 mb-2">{c.subtitle}</div>
                      <p className="text-xs text-stone-600 leading-relaxed">{c.description}</p>
                    </div>
                    <div className="text-xs font-semibold text-stone-700 group-hover:underline mt-auto">
                      {c.cta} →
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Architecture Pipeline ── */}
        <div className="mb-14">
          <h2 className="text-base font-bold text-stone-800 mb-5">Architecture Pipeline</h2>
          <div className="grid grid-cols-5 gap-2">
            {PIPELINE.map((p, i) => (
              <div key={i} className="flex flex-col items-center text-center">
                <div className="w-full bg-white border border-stone-200 rounded-xl px-3 py-3">
                  <div className="text-xs font-bold font-mono text-stone-900">{p.verb}</div>
                  <div className="text-[10px] text-violet-500 mt-0.5">{p.layer}</div>
                  <div className="text-[10px] text-stone-400 mt-1.5 leading-relaxed">{p.note}</div>
                </div>
                {i < PIPELINE.length - 1 && (
                  <div className="text-stone-300 text-sm mt-2">↓</div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 text-[11px] font-mono text-stone-400 bg-stone-100 rounded-xl px-4 py-2.5">
            ทุก command ผ่าน Validate (Business Rules / Dispatcher) — Shadow Command ถูกปฏิเสธเสมอ
          </div>
        </div>

        {/* ── System Knowledge ── */}
        <div className="mb-14" id="knowledge">
          <h2 className="text-base font-bold text-stone-800 mb-1">System Knowledge</h2>
          <p className="text-xs text-stone-400 mb-5">องค์ความรู้ของระบบ — ดาวน์โหลดเป็น JSON หรือส่งให้ AI วิเคราะห์</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {KNOWLEDGE_LINKS.map((r) => (
              <a
                key={r.href}
                href={r.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 border border-stone-200 rounded-xl px-4 py-3 bg-white hover:bg-stone-50 transition"
              >
                <div className="flex-1">
                  <div className="text-xs font-semibold text-stone-800">{r.label}</div>
                  <div className="text-[11px] text-stone-400 mt-0.5">{r.desc}</div>
                </div>
                <span className="text-stone-300 text-xs shrink-0 mt-0.5">↗</span>
              </a>
            ))}
          </div>
        </div>

        {/* ── Execute ── */}
        <div className="mb-14">
          <h2 className="text-base font-bold text-stone-800 mb-5">Execute — Quick Start for External AI</h2>
          <div className="space-y-2">
            {[
              { n: "1", title: "โหลดโครงสร้างระบบ",   code: "GET /observer.json",                                         detail: "หรือวาง /observer ใน AI chat" },
              { n: "2", title: "โหลด Tool Spec",        code: "GET /api/v1/spec",                                           detail: "ได้รายการ function ทั้งหมดในรูปแบบ OpenAI" },
              { n: "3", title: "สร้าง Token",            code: "→ /admin/api-tokens",                                       detail: "token ผูกกับ email — ต้อง login admin ก่อน" },
              { n: "4", title: "เรียก Command",          code: 'POST /api/v1/query\nX-DNA-Token: <token>\n\n{ "command": "debt.list" }', detail: "" },
            ].map(({ n, title, code, detail }) => (
              <div key={n} className="flex gap-4 bg-white border border-stone-100 rounded-2xl px-5 py-4">
                <div className="w-6 h-6 rounded-full bg-stone-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</div>
                <div className="flex-1">
                  <div className="font-semibold text-sm text-stone-800 mb-1.5">{title}</div>
                  <pre className="text-[11px] font-mono bg-stone-50 rounded-lg px-3 py-2 text-stone-700 whitespace-pre-wrap">{code}</pre>
                  {detail && <div className="text-[11px] text-stone-400 mt-1.5">{detail}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Role Guide ── */}
        <div className="border border-stone-200 rounded-2xl p-6 bg-white">
          <h2 className="text-base font-bold text-stone-800 mb-5">แต่ละบทบาทเริ่มต้นอย่างไร</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            {[
              {
                role: "UI Designer",
                steps: ["เปิด /examples — ดูว่าแต่ละหน้าจอต้องใช้ command อะไร", "เปิด /api/v1/spec — รู้ format ของข้อมูล", "ออกแบบ UI ตาม data structure จาก spec"],
              },
              {
                role: "Developer",
                steps: ["เปิด /observer.json — เข้าใจโครงสร้างทั้งระบบ", "โหลด System Knowledge ที่ต้องการ", "เรียก POST /api/v1/query ด้วย token"],
              },
              {
                role: "External AI",
                steps: ["GET /observer.json → follow _links", "GET /api/v1/spec → load all tools", "POST /api/v1/query → execute read commands"],
              },
            ].map(({ role, steps }) => (
              <div key={role} className="border border-stone-100 rounded-xl p-4">
                <div className="font-bold text-stone-800 mb-3">{role}</div>
                <ol className="space-y-1.5">
                  {steps.map((s, i) => (
                    <li key={i} className="flex gap-2 text-stone-600">
                      <span className="text-stone-400 shrink-0">{i + 1}.</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
