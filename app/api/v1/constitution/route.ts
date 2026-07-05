/**
 * GET /api/v1/constitution
 * Public — returns all Iron Rules + design principles of DNA OS
 */
import { NextResponse } from "next/server"

const CONSTITUTION = {
  schema_version: "1.0",
  system: "DNA OS",
  description: "กฎเหล็กที่ทุก AI, developer, และ component ต้องปฏิบัติตาม",

  rules: [
    {
      id: 1,
      category: "data",
      severity: "critical",
      rule_en: "Never hardcode business data — all values come from DB via app_configs",
      rule_th: "ห้าม hardcode ข้อมูลธุรกิจ — ทุกค่าจาก DB via app_configs",
    },
    {
      id: 2,
      category: "data",
      severity: "critical",
      rule_en: "No mock/fake/demo data in source code",
      rule_th: "ห้าม mock/fake/demo data ใน source code",
    },
    {
      id: 10,
      category: "security",
      severity: "critical",
      rule_en: "Every API route must have requireAuth middleware",
      rule_th: "ทุก API route ต้องมี requireAuth",
    },
    {
      id: 11,
      category: "registry",
      severity: "critical",
      rule_en: "Every module must be registered in module-registry.json",
      rule_th: "ทุก Module ต้อง register ใน module-registry.json",
    },
    {
      id: 12,
      category: "registry",
      severity: "critical",
      rule_en: "Every command must be registered in command-registry.json",
      rule_th: "ทุก Command ต้อง register ใน command-registry.json",
    },
    {
      id: 13,
      category: "registry",
      severity: "critical",
      rule_en: "Shadow Commands (not in registry) are always rejected",
      rule_th: "Shadow Command (ไม่อยู่ใน registry) ถูกปฏิเสธเสมอ",
    },
    {
      id: 14,
      category: "architecture",
      severity: "critical",
      rule_en: "Layers V2–V5 must not import @supabase/supabase-js — only V6",
      rule_th: "V2-V5 ห้าม import @supabase/supabase-js — เฉพาะ V6 เท่านั้น",
    },
    {
      id: 15,
      category: "architecture",
      severity: "critical",
      rule_en: "V5-Presenter must not directly import from V3-Engines",
      rule_th: "V5 ห้าม import จาก V3 โดยตรง",
    },
    {
      id: 72,
      category: "human_control",
      severity: "critical",
      rule_en: "All write operations require human confirmation before execution",
      rule_th: "ทุก write ต้อง confirmed จากมนุษย์ก่อน (Rule 72)",
      implication: "External AI calling /api/v1/query will receive requires_confirmation:true for write commands",
    },
    {
      id: 73,
      category: "human_control",
      severity: "critical",
      rule_en: "AI must never change financial state directly",
      rule_th: "AI ห้ามเปลี่ยนสถานะการเงินโดยตรง (Rule 73)",
    },
    {
      id: 83,
      category: "human_control",
      severity: "critical",
      rule_en: "AI must not confirm transactions that haven't passed the Rule Engine",
      rule_th: "AI ห้ามยืนยัน transaction ที่ยังไม่ผ่าน Rule Engine (Rule 83)",
    },
  ],

  design_principles: [
    "AI is a translator, not a decision-maker — it converts natural language to commands",
    "Registry is the single source of truth — if it's not in the registry, it doesn't exist",
    "Every feature must pass through the Command Dispatcher (V2-Rules)",
    "The system grows through registries and workflows, not through AI training",
    "Human control is preserved at all write boundaries — automation assists, humans decide",
  ],

  enforcement: {
    registry_check: "scripts/check-registry.sh validates all files are registered",
    dispatcher: "lib/v2-rules/dispatcher.ts rejects unregistered commands at runtime",
    external_api: "/api/v1/query blocks requires_confirmation commands from external AI",
  },
}

export async function GET() {
  return NextResponse.json(CONSTITUTION, {
    headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" },
  })
}
