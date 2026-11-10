/**
 * /admin/docs — System Docs & Integration Hub
 * หมวดหมู่ที่ 1: ภาพรวมสถาปัตยกรรมระบบ (System Architecture & Runtime Flow)
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

// ไฟล์ Markdown ด้านสถาปัตยกรรมที่ใช้ในหมวดหมู่ที่ 1
const ARCH_DOCS = [
  "ARCHITECTURE.md",
  "ARCHITECTURE_INTEGRATION_PLAN.md",
  "DNA_OS_SYSTEM_OPERATING_GRAPH.md",
  "DNA_OS_EXECUTION_LIFECYCLE.md",
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inline(s: string): string {
  // NOTE: callers pass text that escapeHtml() has already encoded once.
  // Escaping again inside these branches double-encoded entities
  // ("&" -> "&amp;amp;", "<" -> "&amp;lt;") and showed HTML/Thai text wrong.
  // inline code
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code class="px-1 py-0.5 rounded bg-stone-100 text-[0.85em] font-mono">${code}</code>`);
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // italic
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => `<a href="${url}" class="text-blue-600 underline" target="_blank" rel="noreferrer">${text}</a>`);
  return s;
}

function renderMarkdown(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let inCode = false;
  let codeLang = "";
  let codeLines: string[] = [];
  let inUl = false;
  let inOl = false;

  function closeLists() {
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
  }

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (!inCode) {
        closeLists();
        inCode = true;
        codeLang = fence[1] || "";
        codeLines = [];
      } else {
        const langClass = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : "";
        out.push(`<pre class="bg-stone-900 text-green-300 rounded-lg p-4 overflow-auto text-xs my-3"><code${langClass}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inCode = false;
        codeLines = [];
      }
      i++;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      i++;
      continue;
    }

    // blank line
    if (line.trim() === "") {
      closeLists();
      i++;
      continue;
    }

    // headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists();
      const level = h[1].length;
      const text = inline(escapeHtml(h[2]));
      out.push(`<h${level} class="font-bold text-stone-800 mt-6 mb-2 ${level <= 2 ? "text-base border-b border-stone-200 pb-1" : "text-sm"}">${text}</h${level}>`);
      i++;
      continue;
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeLists();
      out.push("<hr class=\"my-4 border-stone-200\" />");
      i++;
      continue;
    }

    // unordered list
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) {
      if (!inUl) { closeLists(); out.push('<ul class="list-disc pl-6 space-y-1 text-sm my-2">'); inUl = true; }
      out.push(`<li>${inline(escapeHtml(ul[1]))}</li>`);
      i++;
      continue;
    }

    // ordered list
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      if (!inOl) { closeLists(); out.push('<ol class="list-decimal pl-6 space-y-1 text-sm my-2">'); inOl = true; }
      out.push(`<li>${inline(escapeHtml(ol[1]))}</li>`);
      i++;
      continue;
    }

    // blockquote
    if (line.startsWith(">")) {
      closeLists();
      out.push(`<blockquote class="border-l-4 border-stone-300 pl-3 text-sm text-stone-600 my-2">${inline(escapeHtml(line.replace(/^>\s?/, "")))}</blockquote>`);
      i++;
      continue;
    }

    // paragraph (collect consecutive non-blank lines)
    closeLists();
    const paraLines: string[] = [line];
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "" && !lines[j].match(/^#{1,6}\s/) && !lines[j].match(/^```/) && !lines[j].match(/^[-*]\s/) && !lines[j].match(/^\d+\.\s/) && !lines[j].startsWith(">")) {
      paraLines.push(lines[j]);
      j++;
    }
    out.push(`<p class="text-sm text-stone-700 leading-relaxed my-2">${inline(escapeHtml(paraLines.join(" ")))}</p>`);
    i = j;
  }

  closeLists();
  if (inCode) {
    out.push(`<pre class="bg-stone-900 text-green-300 rounded-lg p-4 overflow-auto text-xs my-3"><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  return out.join("\n");
}

export default async function DocsCategoryOnePage() {
  await requireAuthPage("/admin/docs", ADMIN_TIER);

  const docs = ARCH_DOCS.map((name) => ({ name, content: readText(name) }));

  return (
    <div className="min-h-screen bg-white text-stone-800">
      <div className="sticky top-0 z-10 bg-white border-b border-stone-200 px-6 py-4">
        <h1 className="text-lg font-bold">หมวดหมู่ที่ 1: ภาพรวมสถาปัตยกรรมระบบ (System Architecture &amp; Runtime Flow)</h1>
        <p className="text-[11px] text-stone-400 mt-0.5">
          แสดงเนื้อหาเต็มจากไฟล์ Markdown จริงในโปรเจกต์ — หมวดหมู่อื่นจะทำทีละหมวดหลังจากนี้
        </p>
      </div>

      <div className="p-6 max-w-4xl mx-auto space-y-8">
        {docs.map((d) => (
          <article key={d.name} className="bg-white border border-stone-200 rounded-xl p-5">
            <h2 className="text-sm font-bold text-stone-500 mb-3">{d.name}</h2>
            {d.content ? (
              <div
                className="markdown-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(d.content) }}
              />
            ) : (
              <p className="text-sm text-stone-400">ไม่พบไฟล์ {d.name}</p>
            )}
          </article>
        ))}

        <div className="text-xs text-stone-400 border-t border-stone-200 pt-4">
          หมวดหมู่ที่ 1 เสร็จสมบูรณ์ — รอคำสั่งเพื่อลุยหมวดหมู่ถัดไป
        </div>
      </div>
    </div>
  );
}