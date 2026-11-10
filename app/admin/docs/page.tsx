/**
 * /admin/docs — System Docs & Integration Hub (ศูนย์รวมคู่มือและ API ทั้งระบบ)
 */
import { readFileSync } from "fs";
import { join } from "path";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";

export const dynamic = "force-dynamic";

function readText(rel: string): string {
  try {
    return readFileSync(join(process.cwd(), rel), "utf8");
  } catch {
    return "";
  }
}

const DOC_FILES = ["ARCHITECTURE.md", "DNA_OS_SYSTEM_OPERATING_GRAPH.md", "PROJECT_CLOSEOUT.md"];

export default async function SystemDocsHubPage() {
  await requireAuthPage("/admin/docs", ADMIN_TIER);

  const moduleRegistry = JSON.parse(readText("registry/module-registry.json") || "{}");
  const modules = (moduleRegistry?.modules ?? {}) as Record<string, any>;
  const moduleEntries = Object.entries(modules);
  const byLayer = moduleEntries.reduce<Record<string, number>>((acc, [, m]) => {
    const layer = m?.layer ?? "unknown";
    acc[layer] = (acc[layer] ?? 0) + 1;
    return acc;
  }, {});
  const entryPoints = moduleEntries
    .filter(([, m]) => m?.entry_point === true)
    .map(([k]) => k)
    .slice(0, 12);

  const docs = DOC_FILES.map((f) => ({ name: f, content: readText(f) }));

  const curlSnippet = `curl -X POST https://<BASE_URL>/api/v1/query \\
  -H "Content-Type: application/json" \\
  -H "X-DNA-Token: <TOKEN>" \\
  -d '{"command":"status","args":{}}'`;

  const nodeSnippet = `const res = await fetch("https://<BASE_URL>/api/v1/query", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-DNA-Token": process.env.DNA_TOKEN },
  body: JSON.stringify({ command: "status", args: {} }),
});
console.log(await res.json());`;

  return (
    <div className="min-h-screen bg-white text-stone-800">
      <div className="sticky top-0 z-10 bg-white border-b border-stone-200 px-6 py-4">
        <h1 className="text-lg font-bold">System Docs &amp; Integration Hub</h1>
        <p className="text-[11px] text-stone-400 mt-0.5">ศูนย์รวมคู่มือและ API ทั้งระบบ — Long-form Wiki</p>
        <nav className="mt-2 flex flex-wrap gap-2 text-[11px]">
          {[
            ["#arch", "Architecture"],
            ["#ai", "AI Agents"],
            ["#mcp", "MCP & Deno"],
            ["#logistics", "Logistics"],
            ["#external", "External APIs"],
            ["#code", "Code Snippets"],
            ["#markdown", "Markdown"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="px-2 py-1 rounded border border-stone-200 hover:bg-stone-50">
              {label}
            </a>
          ))}
        </nav>
      </div>

      <div className="p-6 max-w-5xl mx-auto space-y-10">
        <section id="arch" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">1. ภาพรวมสถาปัตยกรรมระบบ (System Architecture &amp; Runtime Flow)</h2>
          <p className="text-sm text-stone-600">DNA OS, Multi-node local network routing, และ Model Context Protocol (MCP) endpoints</p>
          <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 overflow-auto">
            <svg viewBox="0 0 760 180" className="w-full h-auto" role="img" aria-label="architecture graph">
              <rect x="20" y="60" width="120" height="60" rx="8" fill="#fff" stroke="#d6d3d1" />
              <text x="80" y="95" textAnchor="middle" fontSize="12" fill="#44403c">Client</text>
              <rect x="190" y="60" width="140" height="60" rx="8" fill="#fff" stroke="#d6d3d1" />
              <text x="260" y="95" textAnchor="middle" fontSize="12" fill="#44403c">Next.js App</text>
              <rect x="380" y="60" width="160" height="60" rx="8" fill="#fff" stroke="#d6d3d1" />
              <text x="460" y="95" textAnchor="middle" fontSize="12" fill="#44403c">Cognitive Pipeline</text>
              <rect x="590" y="60" width="150" height="60" rx="8" fill="#fff" stroke="#d6d3d1" />
              <text x="665" y="95" textAnchor="middle" fontSize="12" fill="#44403c">Engines / Supabase</text>
              <line x1="140" y1="90" x2="190" y2="90" stroke="#a8a29e" strokeWidth="2" />
              <line x1="330" y1="90" x2="380" y2="90" stroke="#a8a29e" strokeWidth="2" />
              <line x1="540" y1="90" x2="590" y2="90" stroke="#a8a29e" strokeWidth="2" />
            </svg>
          </div>
          <p className="text-sm text-stone-600">Local AI Inference &amp; Server Clusters: รัน AI ในเครื่องเองแบบไม่ต้องพึ่งพาคลาวด์ภายนอก (ดู DIGITALOCEAN_AI_INFERENCE_DISCOVERY_REPORT.md)</p>
        </section>

        <section id="ai" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">2. ศูนย์ควบคุม AI Agents &amp; โมเดล (AI Agents &amp; LLM Control)</h2>
          <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-2 text-sm">
            <p>รายชื่อโมเดลและสิทธิ์การใช้งาน: การเชื่อมต่อโมเดลระดับสูง (เช่น ระบบความปลอดภัยหรือ AI Defense tasks)</p>
            <p>วิธีการควบคุมและสั่งการ: คู่มือการออกคำสั่ง, การใช้ Prompt Playbooks, และแนวทางการเชื่อมต่อ AI เข้ากับระบบปฏิบัติการภายใน</p>
            <p className="text-xs text-stone-400">ดู registry/ai-adapter-registry.json และ services/ai/*</p>
          </div>
        </section>

        <section id="mcp" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">3. MCP Server &amp; Deno Infrastructure (ระบบหลังบ้านและ Deno)</h2>
          <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-2 text-sm">
            <p>Deno MCP Servers: รายการ Server ทั้งหมดที่เขียนด้วย Deno, วิธีการรัน, การจัดการ Environment Variables</p>
            <p>Runtime Lifecycles: การสร้างและจัดการ disposable workspace environments สำหรับงานเฉพาะกิจ</p>
            <p className="text-xs text-stone-400">ดู dna-os-mcp-server/, supabase/functions/deno.json, mcp.json</p>
          </div>
        </section>

        <section id="logistics" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">4. ระบบโลจิสติกส์ ขนส่ง และห่วงโซ่อุปทาน (Logistics &amp; Transport Systems)</h2>
          <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-2 text-sm">
            <p>ระบบจัดการขนส่ง (Transportation Management): หน้าจอสรุปการทำงานของ AppSheet, การคำนวณเส้นทาง และการจัดส่ง</p>
            <p>โมเดลโลจิสติกส์วัตถุดิบ: ระบบรวบรวมความต้องการวัตถุดิบ (เช่น โรงงานคอนกรีตและทราย)</p>
            <p className="text-xs text-stone-400">ดู engines/transportation-management, /admin/jobs, /admin/debt-tracking</p>
          </div>
        </section>

        <section id="external" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">5. คู่มือเชื่อมต่อ API ภายนอก (External APIs &amp; Integrations)</h2>
          <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-2 text-sm">
            <p><strong>Kob Chat Bot API:</strong> Base URL, Token, การส่งข้อความ/Flex Message, Webhook, Bot Menu</p>
            <p><strong>ระบบชำระเงินและกระเป๋าเงิน:</strong> Mobile Banking (K PLUS, K BIZ) และ LINE Pay</p>
            <p><strong>External Webhooks &amp; Messaging APIs:</strong> โครงสร้างข้อมูล, Billing, ต้นทุนการส่งข้อความ</p>
            <p className="text-xs text-stone-400">ดู /admin/connectors, /admin/api-tokens, /admin/api-explorer</p>
          </div>
        </section>

        <section id="code" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">6. คลังโค้ดตัวอย่างสำหรับนักพัฒนา (Code Snippets &amp; Repositories)</h2>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold mb-1">cURL</div>
              <pre className="bg-stone-900 text-green-400 rounded-lg p-3 text-xs overflow-auto whitespace-pre-wrap">{curlSnippet}</pre>
            </div>
            <div>
              <div className="text-xs font-semibold mb-1">Node.js</div>
              <pre className="bg-stone-900 text-green-400 rounded-lg p-3 text-xs overflow-auto whitespace-pre-wrap">{nodeSnippet}</pre>
            </div>
            <p className="text-sm text-stone-600">ลิงก์แหล่งเก็บโค้ด: การเชื่อมโยงกับ GitHub Organizations และโปรเจกต์ที่เกี่ยวข้อง</p>
          </div>
        </section>

        <section id="modules" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">Modules &amp; Capabilities Catalog</h2>
          <p className="text-sm text-stone-600">จำนวนโมดูลตาม layer (จาก registry/module-registry.json)</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(byLayer).map(([layer, count]) => (
              <div key={layer} className="bg-white border border-stone-200 rounded-lg p-3">
                <div className="text-xs text-stone-400">{layer}</div>
                <div className="text-lg font-bold">{count}</div>
              </div>
            ))}
          </div>
          <div className="text-xs text-stone-500">
            Entry points: {entryPoints.join(", ") || "—"}
          </div>
        </section>

        <section id="markdown" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">Markdown Documentation Viewer</h2>
          <div className="space-y-4">
            {docs.map((d) => (
              <details key={d.name} className="bg-white border border-stone-200 rounded-xl">
                <summary className="px-4 py-2 cursor-pointer text-sm font-semibold">{d.name}</summary>
                <pre className="px-4 py-3 text-xs whitespace-pre-wrap text-stone-700 overflow-auto max-h-96">{d.content}</pre>
              </details>
            ))}
          </div>
        </section>

        <section id="settings" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">Settings</h2>
          <p className="text-sm text-stone-600">จัดการ Connections &amp; Credentials, Environment Variables, Roles &amp; Permissions, System Links</p>
          <a href="/admin/settings" className="inline-block px-3 py-2 bg-stone-900 text-white rounded-lg text-xs">ไปหน้า Settings</a>
        </section>
      </div>
    </div>
  );
}