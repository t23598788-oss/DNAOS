"use client";

/**
 * DNA OS — Integrated Development Workspace shell (owner, 2026-08-05).
 * VS Code-shaped Application Shell ONLY — Activity Bar / Sidebar / tabbed
 * Editor / Bottom Panel / Status Bar. No business logic lives here: every
 * panel below either fetches a real existing API (app/api/admin/workspace/*,
 * /api/governance) — this part is Permanent Architecture — or embeds a real
 * existing page via same-origin `kind: "iframe"` tab (see EditorPane below):
 * /admin/architecture, /admin/schema-audit, /admin/telemetry, /admin/settings,
 * /admin/event-inbox, /admin/traces, /admin/dev-loop.
 *
 * TRANSITIONAL LAYER (owner, 2026-08-05): the iframe embeds are explicitly
 * NOT the permanent destination — they exist only until each embedded page
 * is migrated into a real Native Module inside this shell (its own data
 * fetch + render using this shell's design system, tabs, and Bottom Panel,
 * the same way the "source"/"json" tab kinds already work natively). No
 * iframe embed here should be treated as a finished feature; each is a
 * compatibility bridge that can be deleted once its page is natively
 * rewired, without changing this shell's Activity Bar/Sidebar/tab contract.
 * Anything without a real backend capability renders a NOT_IMPLEMENTED
 * badge with the real reason from that API, never a fabricated result.
 *
 * Single shared shell, not one page per tool (explicit instruction,
 * 2026-08-05) — tool switching is client-side state (activeTool), and every
 * opened file/view is a tab in one Editor Workspace.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  FolderTree, Network, Database, Activity, Play, Bot, FileText, Settings as SettingsIcon,
  File, Folder, ChevronRight, ChevronDown, X, GitBranch, CheckCircle2, XCircle, AlertTriangle,
} from "lucide-react";
import { createBrowserSupabase } from "@/services/supabase/browser";
import arch from "@/registry/architecture.json";

type ToolId = "explorer" | "architecture" | "database" | "runtime" | "automation" | "ai-agents" | "logs" | "settings";

const TOOLS: { id: ToolId; label: string; icon: React.ElementType }[] = [
  { id: "explorer", label: "Explorer", icon: FolderTree },
  { id: "architecture", label: "Architecture", icon: Network },
  { id: "database", label: "Database", icon: Database },
  { id: "runtime", label: "Runtime", icon: Activity },
  { id: "automation", label: "Automation", icon: Play },
  { id: "ai-agents", label: "AI Agents", icon: Bot },
  { id: "logs", label: "Logs", icon: FileText },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

interface Tab {
  id: string;
  title: string;
  kind: "source" | "iframe" | "json";
  payload: string; // file path, iframe src, or a label for the json fetch
}

async function fetchJSON(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export default function IDEWorkspace() {
  const [activeTool, setActiveTool] = useState<ToolId>("explorer");
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [bottomTab, setBottomTab] = useState<"problems" | "logs" | "build-output" | "runtime-events" | "terminal" | "ai-execution">("problems");
  const [status, setStatus] = useState<any>(null);
  const [buildOutput, setBuildOutput] = useState<{ command: string; exit_code: number; output: string; duration_ms: number }[]>([]);

  const openTab = useCallback((tab: Tab) => {
    setTabs((prev) => (prev.find((t) => t.id === tab.id) ? prev : [...prev, tab]));
    setActiveTabId(tab.id);
  }, []);
  const closeTab = useCallback((id: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== id));
    setActiveTabId((cur) => (cur === id ? null : cur));
  }, []);

  const loadStatus = useCallback(async () => {
    const { body } = await fetchJSON("/api/admin/workspace/status");
    setStatus(body);
  }, []);

  useEffect(() => {
    void loadStatus();
    const client = createBrowserSupabase();
    const channel = client
      .channel("ide-shell-status")
      .on("postgres_changes", { event: "*", schema: "public", table: "dev_loop_check_results" }, () => void loadStatus())
      .on("postgres_changes", { event: "*", schema: "public", table: "integration_gateway_events" }, () => void loadStatus())
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [loadStatus]);

  const runAutomation = useCallback(async (key: string) => {
    setBottomTab("build-output");
    const { body } = await fetchJSON("/api/admin/workspace/automation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: key }),
    });
    setBuildOutput((prev) => [body, ...prev]);
    void loadStatus();
  }, [loadStatus]);

  const activeTabObj = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, sans-serif", fontSize: 13, background: "#1e1e1e", color: "#d4d4d4" }}>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <ActivityBar activeTool={activeTool} onSelect={setActiveTool} />
        <Sidebar tool={activeTool} onOpenTab={openTab} onRunAutomation={runAutomation} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <TabStrip tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} />
          <EditorPane tab={activeTabObj} />
          <BottomPanel activeTab={bottomTab} onSelectTab={setBottomTab} status={status} buildOutput={buildOutput} />
        </div>
      </div>
      <StatusBar status={status} />
    </div>
  );
}

function ActivityBar({ activeTool, onSelect }: { activeTool: ToolId; onSelect: (t: ToolId) => void }) {
  return (
    <div style={{ width: 52, background: "#252526", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8, gap: 4, flexShrink: 0 }}>
      {TOOLS.map((t) => {
        const Icon = t.icon;
        const active = activeTool === t.id;
        return (
          <button
            key={t.id}
            title={t.label}
            onClick={() => onSelect(t.id)}
            style={{
              width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
              background: active ? "#37373d" : "transparent", border: "none", borderLeft: active ? "2px solid #fff" : "2px solid transparent",
              color: active ? "#fff" : "#858585", cursor: "pointer", borderRadius: 4,
            }}
          >
            <Icon size={20} />
          </button>
        );
      })}
    </div>
  );
}

function Sidebar({ tool, onOpenTab, onRunAutomation }: { tool: ToolId; onOpenTab: (t: Tab) => void; onRunAutomation: (key: string) => void }) {
  return (
    <div style={{ width: 260, background: "#252526", borderRight: "1px solid #1e1e1e", overflowY: "auto", flexShrink: 0 }}>
      <div style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "#bbb" }}>
        {TOOLS.find((t) => t.id === tool)?.label}
      </div>
      {tool === "explorer" && <ExplorerSidebar onOpenTab={onOpenTab} />}
      {tool === "architecture" && <ArchitectureSidebar onOpenTab={onOpenTab} />}
      {tool === "database" && <DatabaseSidebar onOpenTab={onOpenTab} />}
      {tool === "runtime" && <RuntimeSidebar onOpenTab={onOpenTab} />}
      {tool === "automation" && <AutomationSidebar onRunAutomation={onRunAutomation} />}
      {tool === "ai-agents" && <AiAgentsSidebar />}
      {tool === "logs" && <LogsSidebar onOpenTab={onOpenTab} />}
      {tool === "settings" && <SettingsSidebar onOpenTab={onOpenTab} />}
    </div>
  );
}

// ---- Explorer ----
function ExplorerSidebar({ onOpenTab }: { onOpenTab: (t: Tab) => void }) {
  const [roots, setRoots] = useState<FileTreeNode[] | null>(null);

  useEffect(() => {
    fetchJSON("/api/admin/workspace/tree").then(({ body }) => setRoots(body.roots ?? []));
  }, []);

  if (!roots) return <SidebarMessage text="Loading…" />;
  return (
    <div style={{ padding: "0 4px" }}>
      {roots.map((node) => (
        <TreeNode key={node.path} node={node} depth={0} onOpenTab={onOpenTab} />
      ))}
    </div>
  );
}

function TreeNode({ node, depth, onOpenTab }: { node: FileTreeNode; depth: number; onOpenTab: (t: Tab) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileTreeNode[] | undefined>(node.children);

  const toggle = async () => {
    if (node.type !== "directory") {
      onOpenTab({ id: `source:${node.path}`, title: node.name, kind: "source", payload: node.path });
      return;
    }
    if (!expanded && (!children || children.length === 0)) {
      const { body } = await fetchJSON(`/api/admin/workspace/tree?root=${encodeURIComponent(node.path)}&depth=2`);
      setChildren(body.children ?? []);
    }
    setExpanded((e) => !e);
  };

  const Icon = node.type === "directory" ? Folder : File;
  return (
    <div>
      <div onClick={toggle} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 4px", paddingLeft: 8 + depth * 12, cursor: "pointer", borderRadius: 3, fontSize: 12.5 }}>
        {node.type === "directory" ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span style={{ width: 12 }} />}
        <Icon size={13} />
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{node.name}</span>
      </div>
      {expanded && children?.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} onOpenTab={onOpenTab} />)}
    </div>
  );
}

// ---- Architecture ----
function ArchitectureSidebar({ onOpenTab }: { onOpenTab: (t: Tab) => void }) {
  const layers = Object.entries((arch as any).layers) as [string, any][];
  return (
    <div>
      <SidebarItem label="Registry JSON (governance)" onClick={() => onOpenTab({ id: "json:governance", title: "Registry JSON", kind: "json", payload: "/api/governance" })} />
      {layers.map(([key, layer]) => (
        <SidebarItem
          key={key}
          label={`${layer.name} (${layer.modules.length})`}
          onClick={() => onOpenTab({ id: `iframe:arch:${key}`, title: layer.name, kind: "iframe", payload: `/admin/architecture?layer=${key}` })}
        />
      ))}
    </div>
  );
}

// ---- Database ----
function DatabaseSidebar({ onOpenTab }: { onOpenTab: (t: Tab) => void }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetchJSON("/api/admin/workspace/database").then(({ body }) => setData(body));
  }, []);
  if (!data) return <SidebarMessage text="Loading…" />;
  return (
    <div>
      <div style={{ padding: "4px 12px", fontSize: 11, color: data.connection?.ok ? "#4ec9b0" : "#f14c4c" }}>
        {data.connection?.ok ? `Connected · ${data.connection.latency_ms}ms` : data.connection?.status === "UNKNOWN" ? "Connection status UNKNOWN" : "Unreachable"}
      </div>
      <SidebarItem label={`Schema Audit Log (DDL history)`} onClick={() => onOpenTab({ id: "iframe:schema-audit", title: "Schema Audit", kind: "iframe", payload: "/admin/schema-audit" })} />
      <div style={{ padding: "4px 12px", fontSize: 10, color: "#858585" }}>Column schema: NOT_IMPLEMENTED — {data.column_schema?.reason}</div>
      <div style={{ marginTop: 4, borderTop: "1px solid #333" }}>
        {data.tables.map((t: string) => (
          <div key={t} style={{ padding: "3px 12px", fontSize: 12, fontFamily: "monospace", color: "#ccc" }}>{t}</div>
        ))}
      </div>
    </div>
  );
}

// ---- Runtime ----
function RuntimeSidebar({ onOpenTab }: { onOpenTab: (t: Tab) => void }) {
  return (
    <div>
      <SidebarItem label="Runtime Flow (Telemetry)" onClick={() => onOpenTab({ id: "iframe:telemetry", title: "Runtime Flow", kind: "iframe", payload: "/admin/telemetry" })} />
      <SidebarItem label="Dev Loop Pipeline" onClick={() => onOpenTab({ id: "iframe:dev-loop", title: "Dev Loop Pipeline", kind: "iframe", payload: "/admin/dev-loop" })} />
      <div style={{ padding: "4px 12px", fontSize: 10, color: "#858585" }}>Live events shown in Bottom Panel → Runtime Events</div>
    </div>
  );
}

// ---- Automation ----
function AutomationSidebar({ onRunAutomation }: { onRunAutomation: (key: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [proposals, setProposals] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadProposals = useCallback(async () => {
    const { body } = await fetchJSON("/api/gateway/proposals");
    setProposals(body.proposals ?? []);
  }, []);

  useEffect(() => {
    fetchJSON("/api/admin/workspace/automation").then(({ body }) => setData(body));
    void loadProposals();
    const client = createBrowserSupabase();
    const channel = client
      .channel("ide-shell-proposals")
      .on("postgres_changes", { event: "*", schema: "public", table: "integration_gateway_proposals" }, () => void loadProposals())
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [loadProposals]);

  const propose = async (key: string) => {
    await fetchJSON("/api/gateway/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "vscode", command: key }),
    });
    void loadProposals();
  };

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setBusyId(id);
    await fetchJSON(`/api/gateway/proposals/${id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    setBusyId(null);
    void loadProposals();
  };

  if (!data) return <SidebarMessage text="Loading…" />;
  const pending = proposals.filter((p) => p.status === "pending");
  return (
    <div>
      <div style={{ padding: "6px 12px 2px", fontSize: 10, textTransform: "uppercase", color: "#858585" }}>Run directly</div>
      {data.commands?.map((c: any) => (
        <div key={c.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 12px" }}>
          <SidebarItem label={`▶ ${c.key}`} onClick={() => onRunAutomation(c.key)} />
          <button onClick={() => propose(c.key)} style={{ fontSize: 10, background: "none", border: "1px solid #454545", color: "#ccc", borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>
            propose
          </button>
        </div>
      ))}
      {data.not_implemented?.map((c: any) => (
        <div key={c.key} style={{ padding: "3px 12px", fontSize: 11, color: "#858585" }}>
          {c.key}: NOT_IMPLEMENTED — {c.reason}
        </div>
      ))}
      <div style={{ padding: "6px 12px 2px", fontSize: 10, textTransform: "uppercase", color: "#858585" }}>Pending Proposals ({pending.length})</div>
      {pending.length === 0 && <div style={{ padding: "3px 12px", fontSize: 11, color: "#5a5a5a" }}>None</div>}
      {pending.map((p) => (
        <div key={p.id} style={{ padding: "4px 12px" }}>
          <div style={{ fontSize: 11.5 }}>{(p.evidence as any)?.command} <span style={{ color: "#858585" }}>· {p.provider}</span></div>
          <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
            <button disabled={busyId === p.id} onClick={() => decide(p.id, "approved")} style={{ fontSize: 10, background: "#1e9e5a", border: "none", color: "#fff", borderRadius: 3, padding: "1px 8px", cursor: "pointer" }}>
              approve
            </button>
            <button disabled={busyId === p.id} onClick={() => decide(p.id, "rejected")} style={{ fontSize: 10, background: "#c9312b", border: "none", color: "#fff", borderRadius: 3, padding: "1px 8px", cursor: "pointer" }}>
              reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- AI Agents ----
function AiAgentsSidebar() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    fetchJSON("/api/admin/workspace/ai-agents").then(({ body }) => setData(body));
  }, []);
  if (!data) return <SidebarMessage text="Loading…" />;
  return (
    <div>
      <div style={{ padding: "4px 12px", fontSize: 10, color: "#f0a020" }}>
        Execute/control: {data.execute_capability?.status} — {data.execute_capability?.reason}
      </div>
      <div style={{ padding: "6px 12px 2px", fontSize: 10, textTransform: "uppercase", color: "#858585" }}>Registered Agents</div>
      {data.registered_agents?.map((a: any) => (
        <div key={a.id} style={{ padding: "3px 12px", fontSize: 12 }}>{a.id}</div>
      ))}
      <div style={{ padding: "6px 12px 2px", fontSize: 10, textTransform: "uppercase", color: "#858585" }}>Dev Loop Sessions</div>
      {data.dev_loop_sessions?.map((s: any) => (
        <div key={s.id} style={{ padding: "3px 12px", fontSize: 11 }}>
          <span style={{ color: s.status === "open" ? "#4ec9b0" : "#858585" }}>{s.status}</span> · {s.owner ?? "unknown"}
        </div>
      ))}
    </div>
  );
}

// ---- Logs ----
function LogsSidebar({ onOpenTab }: { onOpenTab: (t: Tab) => void }) {
  return (
    <div>
      <SidebarItem label="Event Inbox" onClick={() => onOpenTab({ id: "iframe:event-inbox", title: "Event Inbox", kind: "iframe", payload: "/admin/event-inbox" })} />
      <SidebarItem label="Traces" onClick={() => onOpenTab({ id: "iframe:traces", title: "Traces", kind: "iframe", payload: "/admin/traces" })} />
      <SidebarItem label="CHANGELOG.json" onClick={() => onOpenTab({ id: "source:registry/CHANGELOG.json", title: "CHANGELOG.json", kind: "source", payload: "registry/CHANGELOG.json" })} />
    </div>
  );
}

// ---- Settings ----
function SettingsSidebar({ onOpenTab }: { onOpenTab: (t: Tab) => void }) {
  return <SidebarItem label="Settings" onClick={() => onOpenTab({ id: "iframe:settings", title: "Settings", kind: "iframe", payload: "/admin/settings" })} />;
}

function SidebarItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div onClick={onClick} style={{ padding: "5px 12px", fontSize: 12.5, cursor: "pointer", color: "#ccc" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2d2e")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {label}
    </div>
  );
}
function SidebarMessage({ text }: { text: string }) {
  return <div style={{ padding: 12, fontSize: 12, color: "#858585" }}>{text}</div>;
}

// ---- Tab strip + editor ----
function TabStrip({ tabs, activeTabId, onSelect, onClose }: { tabs: Tab[]; activeTabId: string | null; onSelect: (id: string) => void; onClose: (id: string) => void }) {
  if (tabs.length === 0) return <div style={{ height: 35, background: "#252526", borderBottom: "1px solid #1e1e1e" }} />;
  return (
    <div style={{ display: "flex", background: "#252526", borderBottom: "1px solid #1e1e1e", overflowX: "auto", flexShrink: 0 }}>
      {tabs.map((t) => (
        <div
          key={t.id}
          onClick={() => onSelect(t.id)}
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", fontSize: 12.5, cursor: "pointer",
            background: activeTabId === t.id ? "#1e1e1e" : "transparent", borderRight: "1px solid #1e1e1e",
            color: activeTabId === t.id ? "#fff" : "#969696", whiteSpace: "nowrap",
          }}
        >
          {t.title}
          <X size={12} onClick={(e) => { e.stopPropagation(); onClose(t.id); }} />
        </div>
      ))}
    </div>
  );
}

function EditorPane({ tab }: { tab: Tab | null }) {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    setContent(null);
    if (!tab) return;
    if (tab.kind === "source") {
      fetchJSON(`/api/admin/workspace/file?path=${encodeURIComponent(tab.payload)}`).then(({ body, ok }) => setContent(ok ? body.content : `Error: ${body.error}`));
    } else if (tab.kind === "json") {
      fetchJSON(tab.payload).then(({ body }) => setContent(JSON.stringify(body, null, 2)));
    }
  }, [tab]);

  if (!tab) {
    return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#5a5a5a" }}>No file open</div>;
  }
  if (tab.kind === "iframe") {
    // TRANSITIONAL LAYER — not the permanent architecture. Real target is a
    // native "source"/"json"-style tab (own fetch + render inside this
    // shell); this iframe bridge is what makes the embedded page reachable
    // today without redesigning it. Safe to delete per-page once that page
    // is natively rewired — this shell's tab/Sidebar contract doesn't change.
    return <iframe src={tab.payload} style={{ flex: 1, border: "none", background: "#fff" }} title={tab.title} />;
  }
  return (
    <pre style={{ flex: 1, margin: 0, padding: 16, overflow: "auto", fontSize: 12.5, fontFamily: "ui-monospace, monospace", whiteSpace: "pre-wrap", color: "#d4d4d4" }}>
      {content ?? "Loading…"}
    </pre>
  );
}

// ---- Bottom panel ----
function BottomPanel({ activeTab, onSelectTab, status, buildOutput }: { activeTab: string; onSelectTab: (t: any) => void; status: any; buildOutput: any[] }) {
  const [liveEvents, setLiveEvents] = useState<any[]>([]);
  const [changelogEntries, setChangelogEntries] = useState<any[] | null>(null);

  const loadLive = useCallback(async () => {
    const client = createBrowserSupabase();
    const [{ data: gw }, { data: dl }] = await Promise.all([
      client.from("integration_gateway_events").select("event_id, provider, capability, occurred_at").order("occurred_at", { ascending: false }).limit(15),
      client.from("dev_loop_evidence_events").select("id, path, event_type, occurred_at").order("occurred_at", { ascending: false }).limit(15),
    ]);
    setLiveEvents([...(gw ?? []).map((e: any) => ({ ...e, kind: "gateway" })), ...(dl ?? []).map((e: any) => ({ ...e, kind: "dev_loop" }))].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1)));
  }, []);

  useEffect(() => {
    void loadLive();
    if (changelogEntries === null) {
      fetchJSON("/api/admin/workspace/file?path=registry/CHANGELOG.json").then(({ body, ok }) => {
        if (!ok) return setChangelogEntries([]);
        try {
          const parsed = JSON.parse(body.content);
          setChangelogEntries((parsed.entries ?? parsed).slice(0, 15));
        } catch {
          setChangelogEntries([]);
        }
      });
    }
  }, [loadLive, changelogEntries]);

  const TABS = [
    { id: "problems", label: `Problems (${status?.problems?.length ?? 0})` },
    { id: "logs", label: "Logs" },
    { id: "build-output", label: "Build Output" },
    { id: "runtime-events", label: "Runtime Events" },
    { id: "terminal", label: "Terminal" },
    { id: "ai-execution", label: "AI Execution" },
  ];

  return (
    <div style={{ height: 200, borderTop: "1px solid #1e1e1e", background: "#1e1e1e", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ display: "flex", background: "#252526" }}>
        {TABS.map((t) => (
          <div key={t.id} onClick={() => onSelectTab(t.id)} style={{ padding: "6px 12px", fontSize: 11.5, cursor: "pointer", color: activeTab === t.id ? "#fff" : "#969696", borderBottom: activeTab === t.id ? "1px solid #fff" : "1px solid transparent" }}>
            {t.label}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 8, fontSize: 12, fontFamily: "ui-monospace, monospace" }}>
        {activeTab === "problems" && (status?.problems ?? []).map((p: any, i: number) => (
          <div key={i} style={{ display: "flex", gap: 6, padding: "2px 0", color: p.severity === "error" ? "#f14c4c" : "#cca700" }}>
            {p.severity === "error" ? <XCircle size={13} /> : <AlertTriangle size={13} />} <span>[{p.source}] {p.message}</span>
          </div>
        ))}
        {activeTab === "logs" && (changelogEntries ?? []).map((e: any, i: number) => (
          <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid #2a2a2a", color: "#ccc" }}>{e.summary ?? e.title ?? JSON.stringify(e).slice(0, 200)}</div>
        ))}
        {activeTab === "build-output" && (buildOutput.length === 0 ? <div style={{ color: "#5a5a5a" }}>No commands run yet — run one from Automation.</div> : buildOutput.map((r, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <div style={{ color: r.exit_code === 0 ? "#4ec9b0" : "#f14c4c" }}>$ {r.command} (exit {r.exit_code}, {r.duration_ms}ms)</div>
            <pre style={{ whiteSpace: "pre-wrap", color: "#ccc", margin: 0 }}>{r.output}</pre>
          </div>
        )))}
        {activeTab === "runtime-events" && liveEvents.map((e, i) => (
          <div key={i} style={{ padding: "2px 0", color: "#ccc" }}>
            [{e.kind}] {e.kind === "gateway" ? `${e.provider}/${e.capability}` : `${e.event_type} ${e.path}`} — {e.occurred_at}
          </div>
        ))}
        {activeTab === "terminal" && <div style={{ color: "#858585" }}>NOT_IMPLEMENTED — an interactive terminal needs a persistent server process; this app runs serverless (Vercel), which cannot host a real PTY session. Use Automation for real command execution instead.</div>}
        {activeTab === "ai-execution" && <div style={{ color: "#858585" }}>NOT_IMPLEMENTED — Integration Gateway Execution Channel is closed. See AI Agents tool for real status.</div>}
      </div>
    </div>
  );
}

// ---- Status bar ----
function StatusBar({ status }: { status: any }) {
  if (!status) {
    return <div style={{ height: 22, background: "#007acc", display: "flex", alignItems: "center", padding: "0 10px", fontSize: 11, color: "#fff", flexShrink: 0 }}>Loading status…</div>;
  }
  return (
    <div style={{ height: 22, background: status.error_count > 0 ? "#a1260d" : "#007acc", display: "flex", alignItems: "center", gap: 16, padding: "0 10px", fontSize: 11, color: "#fff", flexShrink: 0 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}><GitBranch size={12} /> {status.branch}</span>
      <span>{status.build?.status === "passing" ? "Build: Passing" : `Build: Failing (${status.build?.broken_modules})`}</span>
      <span>Type Check: {status.type_check}</span>
      <span>DB: {status.database?.ok ? "Connected" : status.database?.status ?? "Unreachable"}</span>
      <span>Env: {status.runtime_environment}</span>
      <span>Deploy: {status.deployment}</span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}><XCircle size={12} /> {status.error_count}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}><AlertTriangle size={12} /> {status.warning_count}</span>
      </span>
    </div>
  );
}
