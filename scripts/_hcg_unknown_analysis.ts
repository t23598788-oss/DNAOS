import { scanRepository } from "@/engines/governance/hardcode-decision-engine";

const dirs = ["services", "gateway", "engines/validation", "engines/debt", "engines/documents", "core/executor", "app/api/admin", "supabase/functions"];
let all: any[] = [];
for (const d of dirs) {
  try { all = all.concat(scanRepository(d)); } catch {}
}
const unknown = all.filter((c) => c.category === "UNKNOWN");
console.log("Total UNKNOWN:", unknown.length);

function mask(v: string): string {
  // Mask anything that looks like it could be a secret-shaped token (long alnum/mixed-case run)
  if (/^[A-Za-z0-9_\-+/=]{20,}$/.test(v) || /^[A-Za-z0-9]{16,}$/.test(v)) {
    return v.slice(0, 4) + "***MASKED***" + v.slice(-2);
  }
  return v;
}

interface Bucket { name: string; test: (v: string, file: string) => boolean; }
const buckets: Bucket[] = [
  { name: "import/module path", test: (v) => /^[@.\/][\w\-./]+$/.test(v) && (v.includes("/") || v.startsWith("@")) },
  { name: "route/URL path (internal)", test: (v, f) => /^\/(api|admin|app)?[\w\-\/\[\]]*$/.test(v) && v.startsWith("/") },
  { name: "full URL", test: (v) => /^https?:\/\//.test(v) },
  { name: "event name (dot.case)", test: (v) => /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/.test(v) && !v.includes(" ") },
  { name: "SQL / DB column-table (snake_case identifier)", test: (v) => /^[a-z][a-z0-9_]*$/.test(v) && v.includes("_") && v.length < 40 },
  { name: "HTTP method", test: (v) => ["GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS"].includes(v) },
  { name: "enum-like SCREAMING_SNAKE", test: (v) => /^[A-Z][A-Z0-9_]{2,}$/.test(v) },
  { name: "file extension / path fragment", test: (v) => /^\.[a-z0-9]{1,5}$/.test(v) },
  { name: "date/time format token", test: (v) => /^(YYYY|MM|DD|HH|mm|ss|[Y\-M\/D: ]{4,})+$/.test(v) },
  { name: "env var name (SCREAMING_SNAKE, looks like process.env key)", test: (v, f) => /^[A-Z][A-Z0-9_]{3,}$/.test(v) },
  { name: "Thai/English UI or log/error message (contains space)", test: (v) => v.includes(" ") },
  { name: "template literal with interpolation", test: (v) => v.includes("${") },
  { name: "single short word/token (<=3 chars)", test: (v) => v.length <= 3 },
  { name: "long alnum token (possible secret/id/hash)", test: (v) => /^[A-Za-z0-9_\-+/=]{16,}$/.test(v) },
];

const grouped: Record<string, { count: number; examples: { file: string; line: number; value: string }[] }> = {};
const unclassified: { file: string; line: number; value: string }[] = [];

for (const u of unknown) {
  let matched = false;
  for (const b of buckets) {
    if (b.test(u.value, u.file)) {
      grouped[b.name] = grouped[b.name] || { count: 0, examples: [] };
      grouped[b.name].count++;
      if (grouped[b.name].examples.length < 5) grouped[b.name].examples.push({ file: u.file.replace(process.cwd(), ""), line: u.line, value: mask(u.value) });
      matched = true;
      break;
    }
  }
  if (!matched) {
    unclassified.push({ file: u.file.replace(process.cwd(), ""), line: u.line, value: mask(u.value) });
  }
}

for (const [name, g] of Object.entries(grouped).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`\n=== ${name}: ${g.count} ===`);
  g.examples.forEach((e) => console.log(`  ${e.file}:${e.line}  "${e.value.slice(0, 70)}"`));
}
console.log(`\n=== ไม่สามารถจำแนกได้จริง (unclassified): ${unclassified.length} ===`);
unclassified.slice(0, 15).forEach((e) => console.log(`  ${e.file}:${e.line}  "${e.value.slice(0, 70)}"`));
