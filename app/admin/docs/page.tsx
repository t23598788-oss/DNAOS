/**
 * /admin/docs — Unified Docs & Settings (หน้าเดียวจบ)
 *
 * โครงสร้าง scroll-down:
 *  1. System Overview & Architecture Graphs
 *  2. Bot & API Integration (Kob Chat Bot API)
 *  3. Modules & Capabilities Catalog
 *  4. Code Snippets & Playbooks
 *  5. Markdown Documentation Viewer
 *  6. Settings shortcut (เชื่อมไป /admin/settings)
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

export default async function UnifiedDocsPage() {
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
  headers: {
    "Content-Type": "application/json",
    "X-DNA-Token": process.env.DNA_TOKEN,
  },
  body: JSON.stringify({ command: "status", args: {} }),
});
console.log(await res.json());`;

  return (
    <div className="min-h-screen bg-white text-stone-800">
      <div className="sticky top-0 z-10 bg-white border-b border-stone-200 px-6 py-4">
        <h1 className="text-lg font-bold">คู่มือการเชื่อมต่อและตั้งค่าระบบ (Unified Docs &amp; Settings)</h1>
        <p className="text-[11px] text-stone-400 mt-0.5">หน้าเดียวจบ — scroll ลงเพื่ออ่านทุกส่วน</p>
        <nav className="mt-2 flex flex-wrap gap-2 text-[11px]">
          {[
            ["#overview", "ภาพรวม"],
            ["#bot-api", "Bot & API"],
            ["#modules", "โมดูล"],
            ["#snippets", "Code Snippets"],
            ["#markdown", "Markdown"],
            ["#settings", "Settings"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="px-2 py-1 rounded border border-stone-200 hover:bg-stone-50">
              {label}
            </a>
          ))}
        </nav>
      </div>

      <div className="p-6 max-w-5xl mx-auto space-y-10">
        {/* 1. Overview */}
        <section id="overview" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">1. System Overview &amp; Architecture Graphs</h2>
          <p className="text-sm text-stone-600">
            ภาพรวมการทำงานของระบบ DNA OS: Client → Next.js (App Router) → Cognitive Pipeline → Engines/Supabase
          </p>
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
        </section>

        {/* 2. Bot & API */}
        <section id="bot-api" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">2. Bot &amp; API Integration</h2>
          <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-2 text-sm">
            <p><strong>Base URL:</strong> <code className="font-mono bg-stone-100 px-1 rounded">https://&lt;host&gt;</code></p>
            <p><strong>Auth:</strong> Header <code className="font-mono bg-stone-100 px-1 rounded">X-DNA-Token: &lt;TOKEN&gt;</code></p>
            <p><strong>Message endpoint:</strong> <code className="font-mono bg-stone-100 px-1 rounded">POST /api/v1/query</code></p>
            <p><strong>Webhook:</strong> ตั้งค่าใน Connectors (LINE webhook v2) — ดู /admin/connectors</p>
            <p><strong>JSON (Flex/Card):</strong> ส่งผ่าน command payload ใน body; response เป็น JSON ตาม cognitive board</p>
          </div>
        </section>

        {/* 3. Modules */}
        <section id="modules" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">3. Modules &amp; Capabilities Catalog</h2>
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

        {/* 4. Snippets */}
        <section id="snippets" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">4. Code Snippets &amp; Playbooks</h2>
          <div className="space-y-3">
            <div>
              <div className="text-xs font-semibold mb-1">cURL</div>
              <pre className="bg-stone-900 text-green-400 rounded-lg p-3 text-xs overflow-auto whitespace-pre-wrap">{curlSnippet}</pre>
            </div>
            <div>
              <div className="text-xs font-semibold mb-1">Node.js</div>
              <pre className="bg-stone-900 text-green-400 rounded-lg p-3 text-xs overflow-auto whitespace-pre-wrap">{nodeSnippet}</pre>
            </div>
          </div>
        </section>

        {/* 5. Markdown */}
        <section id="markdown" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">5. Markdown Documentation Viewer</h2>
          <div className="space-y-4">
            {docs.map((d) => (
              <details key={d.name} className="bg-white border border-stone-200 rounded-xl">
                <summary className="px-4 py-2 cursor-pointer text-sm font-semibold">{d.name}</summary>
                <pre className="px-4 py-3 text-xs whitespace-pre-wrap text-stone-700 overflow-auto max-h-96">{d.content}</pre>
              </details>
            ))}
          </div>
        </section>

        {/* 6. Settings */}
        <section id="settings" className="space-y-3">
          <h2 className="text-base font-bold border-b border-stone-200 pb-1">6. Settings</h2>
          <p className="text-sm text-stone-600">
            จัดการ Connections &amp; Credentials, Environment Variables, Roles &amp; Permissions, System Links
          </p>
          <a href="/admin/settings" className="inline-block px-3 py-2 bg-stone-900 text-white rounded-lg text-xs">
            ไปหน้า Settings
          </a>
        </section>
      </div>
    </div>
  );
}