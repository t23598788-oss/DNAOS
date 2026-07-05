"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";

// ── Types ──────────────────────────────────────────

interface FileItem {
  path: string;
  type: string;
  size: number;
}

interface DepNode {
  id: string;
  name_en: string;
  layer: string;
  status: string;
}

interface FileContent {
  path: string;
  ext: string;
  size: number;
  modified_at: string;
  content: string;
  parsed: any;
  imports: DepNode[];
  importedBy: DepNode[];
  error_th?: string;
}

// ── JSON Formatter ─────────────────────────────────

function JsonValue({ value, depth = 0 }: { value: any; depth?: number }) {
  if (value === null) return <span className="text-stone-400">null</span>;
  if (typeof value === "boolean") return <span className="text-amber-400">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-sky-400">{value}</span>;
  if (typeof value === "string") return <span className="text-green-400">"{value}"</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-stone-500">[]</span>;
    if (typeof value[0] !== "object") {
      return (
        <span>
          [<span className="text-green-400">{value.map((v) => `"${v}"`).join(", ")}</span>]
        </span>
      );
    }
    return (
      <span>
        {"[\n"}
        {value.slice(0, 20).map((item, i) => (
          <span key={i}>
            {"  ".repeat(depth + 1)}
            <JsonValue value={item} depth={depth + 1} />
            {i < value.length - 1 ? ",\n" : "\n"}
          </span>
        ))}
        {value.length > 20 && (
          <span className="text-stone-500">{"  ".repeat(depth)}  …{value.length - 20} more\n</span>
        )}
        {"  ".repeat(depth)}]
      </span>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).slice(0, 30);
    return (
      <span>
        {"{\n"}
        {entries.map(([k, v], i) => (
          <span key={k}>
            {"  ".repeat(depth + 1)}
            <span className="text-violet-400">"{k}"</span>: <JsonValue value={v} depth={depth + 1} />
            {i < entries.length - 1 ? ",\n" : "\n"}
          </span>
        ))}
        {Object.keys(value).length > 30 && (
          <span className="text-stone-500">
            {"  ".repeat(depth + 1)}…{Object.keys(value).length - 30} more keys\n
          </span>
        )}
        {"  ".repeat(depth)}{"}"}
      </span>
    );
  }
  return <span>{String(value)}</span>;
}

// ── Dep Badge ──────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  OK: "bg-green-400", BROKEN: "bg-red-400", UNUSED: "bg-yellow-400", UNREGISTERED: "bg-slate-400",
};

function DepBadge({ node, onClick }: { node: DepNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-1 bg-stone-800 hover:bg-stone-700 rounded-lg text-left transition"
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[node.status] ?? "bg-stone-400"}`} />
      <span className="text-[10px] font-mono text-stone-300 truncate max-w-[160px]">
        {node.name_en?.split("/").slice(-1)[0] ?? node.id}
      </span>
      <span className="text-[9px] text-stone-500 shrink-0">{node.layer}</span>
    </button>
  );
}

// ── Main content (needs Suspense for useSearchParams) ──

function ReaderContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/reader?path=list")
      .then((r) => r.json())
      .then((d) => setFiles(d.files ?? []));
  }, []);

  const openFile = useCallback(async (path: string) => {
    setSelected(path);
    setLoading(true);
    setContent(null);
    const res = await fetch(`/api/reader?path=${encodeURIComponent(path)}`);
    setContent(await res.json());
    setLoading(false);
  }, []);

  // รับ ?path= จาก URL (เช่น คลิกจาก Dashboard / Graph / API Explorer)
  useEffect(() => {
    const p = searchParams.get("path");
    if (p && p !== selected) openFile(p);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = files.filter((f) =>
    f.path.toLowerCase().includes(search.toLowerCase())
  );

  const byFolder: Record<string, FileItem[]> = {};
  for (const f of filtered) {
    const folder = f.path.split("/").slice(0, 2).join("/");
    if (!byFolder[folder]) byFolder[folder] = [];
    byFolder[folder].push(f);
  }

  return (
    <div className="min-h-screen bg-stone-50 flex">
      {/* ── Sidebar ── */}
      <aside className="w-64 bg-white border-r border-stone-200 flex flex-col shrink-0">
        <div className="px-3 py-3 border-b border-stone-100">
          <h1 className="text-sm font-bold text-stone-800">Reader</h1>
          <p className="text-[10px] text-stone-400">อ่าน Registry และ Source</p>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาไฟล์…"
            className="mt-2 w-full px-2.5 py-1.5 text-[11px] border border-stone-200 rounded-lg outline-none focus:border-violet-400"
          />
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {Object.entries(byFolder).map(([folder, items]) => (
            <div key={folder}>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-stone-400 uppercase tracking-wider">
                {folder}
              </div>
              {items.map((f) => (
                <button
                  key={f.path}
                  onClick={() => {
                    openFile(f.path);
                    router.replace(`/admin/reader?path=${encodeURIComponent(f.path)}`);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] truncate transition ${
                    selected === f.path
                      ? "bg-violet-50 text-violet-700 font-medium"
                      : "text-stone-600 hover:bg-stone-50"
                  }`}
                >
                  {f.path.split("/").pop()}
                  <span className="ml-1 text-stone-300 font-mono">.{f.type}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>

      {/* ── Content ── */}
      <main className="flex-1 min-w-0 overflow-auto">
        {!selected && !loading && (
          <div className="flex items-center justify-center h-full text-stone-400 text-sm">
            เลือกไฟล์จากเมนูซ้ายเพื่ออ่าน
          </div>
        )}
        {loading && (
          <div className="flex items-center justify-center h-full text-stone-400 text-sm">
            กำลังโหลด…
          </div>
        )}
        {content && !loading && (
          <div className="p-6 space-y-4">
            {/* Header */}
            <div>
              <div className="text-sm font-mono font-semibold text-stone-700">{content.path}</div>
              <div className="text-[11px] text-stone-400 mt-0.5">
                {content.ext.toUpperCase()} · {(content.size / 1024).toFixed(1)} KB ·
                แก้ไขล่าสุด: {new Date(content.modified_at).toLocaleString("th-TH")}
              </div>
            </div>

            {/* Error */}
            {content.error_th && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
                {content.error_th}
              </div>
            )}

            {/* File content */}
            <div className="bg-stone-900 rounded-xl p-5 overflow-auto">
              <pre className="text-xs font-mono leading-relaxed">
                {content.parsed !== null ? (
                  <JsonValue value={content.parsed} />
                ) : (
                  <span className="text-stone-300">{content.content}</span>
                )}
              </pre>
            </div>

            {/* ── Dependency panels ── */}
            {(content.imports?.length > 0 || content.importedBy?.length > 0) && (
              <div className="grid grid-cols-2 gap-4">
                {/* Imports */}
                <div className="bg-stone-900 rounded-xl p-4">
                  <div className="text-[10px] text-stone-400 mb-2 uppercase tracking-wider">
                    import จาก ({content.imports?.length ?? 0})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {content.imports?.length ? (
                      content.imports.map((n) => (
                        <DepBadge
                          key={n.id}
                          node={n}
                          onClick={() => {
                            const path = n.id.replace("module:", "");
                            openFile(path);
                            router.replace(`/admin/reader?path=${encodeURIComponent(path)}`);
                          }}
                        />
                      ))
                    ) : (
                      <span className="text-[11px] text-stone-600">ไม่ได้ import ใคร</span>
                    )}
                  </div>
                </div>

                {/* Imported by */}
                <div className="bg-stone-900 rounded-xl p-4">
                  <div className="text-[10px] text-stone-400 mb-2 uppercase tracking-wider">
                    ถูก import โดย ({content.importedBy?.length ?? 0})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {content.importedBy?.length ? (
                      content.importedBy.map((n) => (
                        <DepBadge
                          key={n.id}
                          node={n}
                          onClick={() => {
                            const path = n.id.replace("module:", "");
                            openFile(path);
                            router.replace(`/admin/reader?path=${encodeURIComponent(path)}`);
                          }}
                        />
                      ))
                    ) : (
                      <span className="text-[11px] text-stone-600">ไม่มีใคร import ไฟล์นี้</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ── Page wrapper ───────────────────────────────────

export default function ReaderPage() {
  return (
    <Suspense>
      <ReaderContent />
    </Suspense>
  );
}
