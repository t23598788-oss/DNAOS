// patch235c: fix supabaseAdmin() + registry CommandDef
import { readFileSync, writeFileSync } from "node:fs"
const root = "/Users/tam/Desktop/ระบบธุรกิจ/dna-os-maincheck/"
const dp = root + "engines/validation/dispatcher.ts"
let d = readFileSync(dp, "utf8")
d = d.split(`supabaseAdmin.from("invoices")`).join(`supabaseAdmin().from("invoices")`)
writeFileSync(dp, d)
console.log("supabaseAdmin() fixed:", (d.match(/supabaseAdmin\(\)\.from\("invoices"\)/g) ?? []).length)
const rp = root + "registry/command-registry.json"
const r = JSON.parse(readFileSync(rp, "utf8"))
const c = r.commands || r
c["purchase.history"] = {
  owner: "engines/validation/dispatcher.ts", layer: "engines",
  input: { company: "string", material: "string" },
  output: "{invoices|evidence|PARTIAL_RESULT}",
  description: "PurchaseHistory — ประวัติซื้อขายจากใบแจ้งหนี้จริง (ไม่นับ VOID; material จับคู่จาก invoice_items.description ไม่ใช่ FK master)",
  requires_confirmation: false,
}
writeFileSync(rp, JSON.stringify(r, null, 2) + "\n")
console.log("registry fixed")
