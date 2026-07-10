/**
 * GET /observer.json
 *
 * Machine-readable version of /observer
 * ให้ AI โหลดในคำขอเดียวแล้วเข้าใจระบบทั้งหมด
 * มี _links ไปยัง sub-registries เหมือน HAL JSON / OpenAPI $ref
 *
 * Public — ไม่มีข้อมูลธุรกิจจริง (static registries เท่านั้น)
 */

import { NextResponse } from "next/server"
import commandRegistry from "@/registry/command-registry.json"
import moduleRegistry  from "@/registry/module-registry.json"
import businessCoverage from "@/registry/business-coverage.json"
import existenceRegistry from "@/registry/existence.json"
import driversRegistry   from "@/registry/drivers.json"
import workflowRegistry  from "@/07-workflow-registry.json"
import documentRegistry  from "@/08-document-registry.json"

const LAYERS = [
  { id: "Input Gateway",      code: "V1-Input",     path: "lib/v1-input/",     role: "Receives all events (LINE, HTTP, Webhook) and converts to JSON. Cannot write DB." },
  { id: "Business Rules",     code: "V2-Rules",     path: "engines/validation/",     role: "Dispatcher + Validation + Business Rules. Every command must pass through here." },
  { id: "Business Engine",    code: "V3-Engines",   path: "engines/",   role: "Computes business logic (pricing, debt, tax, timeline). No hardcode. No DB writes." },
  { id: "AI Interpreter",     code: "V4-AI",        path: "services/ai/",        role: "Translates natural language to commands only. Cannot make decisions or write DB." },
  { id: "Presentation Layer", code: "V5-Presenter", path: "presenter/", role: "Formats output for display. Cannot import Business Engine directly." },
  { id: "Execution Layer",    code: "V6-Executor",  path: "gateway/",  role: "Single gate for DB writes, LINE messages, and external service calls." },
  { id: "Decision Pipeline",  code: "Cognitive",    path: "cognitive/",    role: "Central pipeline: Intent → Plan → Execute → Reflect" },
  { id: "Security & Auth",    code: "Middleware",   path: "services/middleware/",   role: "requireAuth + Sanitize — enforced on every API route" },
]

const CONSTITUTION = {
  version: 1,
  source: "/api/v1/constitution",
  rules: [
    { id: 1,  rule: "ห้าม hardcode ข้อมูลธุรกิจ — ทุกค่าจาก DB via app_configs" },
    { id: 2,  rule: "ห้าม mock/fake/demo data ใน source code" },
    { id: 72, rule: "ทุก write ต้อง confirmed จากมนุษย์ (Rule 72)" },
    { id: 73, rule: "AI ห้ามเปลี่ยนสถานะการเงิน (Rule 73)" },
    { id: 83, rule: "AI ห้ามยืนยัน transaction ที่ยังไม่ผ่าน Rule Engine (Rule 83)" },
    { id: 10, rule: "ทุก API route ต้องมี requireAuth" },
    { id: 11, rule: "ทุก Module ต้อง register ใน module-registry.json" },
    { id: 12, rule: "ทุก Command ต้อง register ใน command-registry.json" },
    { id: 13, rule: "Shadow Command (ไม่อยู่ใน registry) ถูกปฏิเสธเสมอ" },
    { id: 14, rule: "V2-V5 ห้าม import @supabase/supabase-js — เฉพาะ V6" },
    { id: 15, rule: "V5 ห้าม import จาก V3 โดยตรง" },
  ]
}

function countModulesByLayer() {
  const counts: Record<string, number> = {}
  for (const [, m] of Object.entries(moduleRegistry.modules)) {
    const layer = (m as any).layer ?? "unknown"
    counts[layer] = (counts[layer] ?? 0) + 1
  }
  return counts
}

export async function GET() {
  const moduleCount = Object.keys(moduleRegistry.modules).length
  const commandCount = Object.keys(commandRegistry.commands).filter(k => !k.startsWith("_")).length

  const payload = {
    system: "DNA OS",
    schema_version: "2.0",
    description: "Registry-Driven ERP Platform — event-centric, AI-extensible",
    design_shift: "2026-07: Document-centric → Relationship + Event-centric",
    generated_at: new Date().toISOString(),

    // ── HAL-style links ──
    _links: {
      self:         { href: "/observer.json",        type: "application/json" },
      observer_html:{ href: "/observer",             type: "text/html",  note: "Human-readable version" },
      spec:         { href: "/api/v1/spec",          type: "application/json", note: "OpenAI function-calling format — load this to know all callable tools" },
      query:        { href: "/api/v1/query",         method: "POST", auth: "Header: X-DNA-Token", note: "Send commands here" },
      modules:      { href: "/api/v1/modules",       type: "application/json" },
      workflows:    { href: "/api/v1/workflows",     type: "application/json" },
      constitution: { href: "/api/v1/constitution",  type: "application/json" },
      capabilities: { href: "/api/v1/capabilities",  type: "application/json" },
      drivers:      { href: "/api/v1/drivers",       type: "application/json" },
      tokens_ui:    { href: "/admin/api-tokens",     note: "Generate X-DNA-Token here (requires admin login)" },
    },

    // ── Summary stats ──
    stats: {
      total_modules: moduleCount,
      total_commands: commandCount,
      modules_by_layer: countModulesByLayer(),
      total_drivers: Object.keys(driversRegistry.drivers).length,
      total_domains: Object.keys(businessCoverage.domains).length,
      total_workflows: Object.keys((workflowRegistry as any).workflows ?? {}).length,
      total_document_types: Object.keys((documentRegistry as any).documents ?? {}).length,
    },

    // ── Architecture Pipeline ──
    architecture_pipeline: LAYERS,

    // ── Constitution (summary — full at /api/v1/constitution) ──
    constitution: CONSTITUTION,

    // ── Commands (read-only subset — full list at /api/v1/spec) ──
    commands_summary: Object.entries(commandRegistry.commands)
      .filter(([k]) => !k.startsWith("_"))
      .map(([name, d]: [string, any]) => ({
        name,
        description_th: d.description_th ?? d.description,
        layer: d.layer,
        requires_confirmation: d.requires_confirmation ?? false,
        input: d.input ?? {},
        output: d.output ?? "unknown",
      })),

    // ── Business Domains ──
    business_domains: businessCoverage.domains,

    // ── Capabilities ──
    capabilities_summary: Object.fromEntries(
      Object.entries((existenceRegistry as any).capabilities ?? {})
        .map(([k, v]: [string, any]) => [k, { status: v.status, gap: v.gap }])
    ),

    // ── Drivers ──
    drivers: driversRegistry.drivers,

    // ── Database Tables (schema summary) ──
    db_tables: [
      { name: "partners",              key_cols: "id, name, partner_type_label, phone, address, tax_id" },
      { name: "documents",             key_cols: "id, document_type, document_number, status, partner_id, net_amount, issue_date, business_event_id" },
      { name: "document_items",        key_cols: "id, document_id, line_no, description, qty, unit_price" },
      { name: "debt_trackings",        key_cols: "id, partner_id, principal_amount, fee_rate, interest_start_at" },
      { name: "invoice_debts",         key_cols: "id, document_id, invoice_status, outstanding_amount, paid_amount" },
      { name: "business_events",       key_cols: "id, partner_id, event_type, event_date, title, metadata" },
      { name: "jobs",                  key_cols: "id, partner_id, job_status, distance_km, required_quantity" },
      { name: "line_events",           key_cols: "id, event_type, group_id, message_id, raw_json" },
      { name: "line_draft_documents",  key_cols: "id, doc_type, status, payload" },
      { name: "app_configs",           key_cols: "title, data  (business rules single source of truth)" },
      { name: "material_types",        key_cols: "id, name" },
      { name: "api_tokens",            key_cols: "id, user_email, token, label, scopes, last_used_at, revoked_at" },
    ],

    // ── How to use this API ──
    quick_start: [
      "1. GET /observer.json — you are here — load this to understand the system",
      "2. GET /api/v1/spec — load tool definitions in OpenAI function-calling format",
      "3. GET /admin/api-tokens — generate a token (requires admin login)",
      "4. POST /api/v1/query  Body: {command, args}  Header: X-DNA-Token: <token>",
      "5. Read-only commands execute immediately. Write commands return requires_confirmation:true.",
    ],
  }

  return NextResponse.json(payload, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/json",
    },
  })
}
