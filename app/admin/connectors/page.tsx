"use client";

import { useState, useEffect, useCallback } from "react";

type AuthType = "login" | "oauth" | "api_key" | "token" | "uri" | "mcp" | "webhook";
type Status = "disconnected" | "connecting" | "connected" | "error";

interface Connector {
  id: string;
  name: string;
  slug: string;
  auth_type: AuthType;
  status: Status;
  enabled: boolean;
  config: Record<string, any>;
  secret: Record<string, any>;
  last_checked_at: string | null;
  last_error: string | null;
  created_at: string;
}

const AUTH_TYPE_LABELS: Record<AuthType, string> = {
  login: "Login (username/password)",
  oauth: "OAuth 2.0",
  api_key: "API Key",
  token: "Token",
  uri: "URI",
  mcp: "MCP",
  webhook: "Webhook (inbound)",
};

const STATUS_CONFIG: Record<Status, { label: string; dot: string; text: string }> = {
  connected: { label: "Test ผ่าน", dot: "bg-emerald-500", text: "text-emerald-700" },
  connecting: { label: "กำลังทดสอบ...", dot: "bg-amber-400 animate-pulse", text: "text-amber-700" },
  disconnected: { label: "ยังไม่เชื่อมต่อ", dot: "bg-stone-300", text: "text-stone-500" },
  error: { label: "เชื่อมต่อล้มเหลว", dot: "bg-red-500", text: "text-red-700" },
};

// Connect → Register → Test → Enable
function LifecycleSteps({ c }: { c: Connector }) {
  const step2 = true; // Register — อัตโนมัติทันทีที่ Connect (แถวนี้มีอยู่ = register แล้ว)
  const step3 = c.status === "connected" ? "pass" : c.status === "error" ? "fail" : "pending";
  const step4 = c.enabled;

  const dot = (state: "done" | "pass" | "fail" | "pending") =>
    state === "done" || state === "pass" ? "bg-emerald-500" : state === "fail" ? "bg-red-500" : "bg-stone-300";

  return (
    <div className="flex items-center gap-1 text-[10px] text-stone-400">
      <span className={`w-1.5 h-1.5 rounded-full ${dot("done")}`} /> Connect
      <span className="text-stone-200">→</span>
      <span className={`w-1.5 h-1.5 rounded-full ${dot(step2 ? "done" : "pending")}`} /> Register
      <span className="text-stone-200">→</span>
      <span className={`w-1.5 h-1.5 rounded-full ${dot(step3 as any)}`} /> Test
      <span className="text-stone-200">→</span>
      <span className={`w-1.5 h-1.5 rounded-full ${dot(step4 ? "done" : "pending")}`} /> Enable
    </div>
  );
}

function StatusPill({ status }: { status: Status }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.text} bg-stone-50 border border-stone-200`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ── ฟิลด์ต่อ auth_type ──────────────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  target: "config" | "secret";
  secret?: boolean;
  placeholder?: string;
  optional?: boolean;
}

const FIELDS_BY_TYPE: Record<AuthType, FieldDef[]> = {
  login: [
    { key: "login_url", label: "Login URL", target: "config", placeholder: "https://service.example.com/login" },
    { key: "username_field", label: "ชื่อฟิลด์ username (ถ้าไม่ใช่ 'username')", target: "config", optional: true },
    { key: "password_field", label: "ชื่อฟิลด์ password (ถ้าไม่ใช่ 'password')", target: "config", optional: true },
    { key: "username", label: "Username", target: "secret" },
    { key: "password", label: "Password", target: "secret", secret: true },
  ],
  oauth: [
    { key: "authorize_url", label: "Authorize URL", target: "config", placeholder: "https://service.example.com/oauth/authorize" },
    { key: "token_url", label: "Token URL", target: "config", placeholder: "https://service.example.com/oauth/token" },
    { key: "scope", label: "Scope (คั่นด้วยช่องว่าง)", target: "config", optional: true },
    { key: "test_url", label: "Test URL (เรียกหลัง connect เพื่อตรวจสอบ)", target: "config", optional: true },
    { key: "client_id", label: "Client ID", target: "config" },
    { key: "client_secret", label: "Client Secret", target: "secret", secret: true },
  ],
  api_key: [
    { key: "base_url", label: "Base URL", target: "config", placeholder: "https://api.example.com" },
    { key: "test_path", label: "Test Path (เช่น /ping)", target: "config", optional: true },
    { key: "header_name", label: "ชื่อ Header (ค่าเริ่มต้น Authorization)", target: "config", optional: true },
    { key: "header_prefix", label: "Prefix ของค่า (ค่าเริ่มต้น 'Bearer ')", target: "config", optional: true },
    { key: "api_key", label: "API Key", target: "secret", secret: true },
  ],
  token: [
    { key: "base_url", label: "Base URL", target: "config", placeholder: "https://api.example.com" },
    { key: "test_path", label: "Test Path (เช่น /ping)", target: "config", optional: true },
    { key: "token", label: "Token", target: "secret", secret: true },
  ],
  uri: [
    { key: "url", label: "URL", target: "config", placeholder: "https://example.com/health" },
    { key: "method", label: "HTTP Method (ค่าเริ่มต้น GET)", target: "config", optional: true },
  ],
  mcp: [
    { key: "url", label: "MCP Server URL", target: "config", placeholder: "https://mcp.example.com" },
    { key: "auth_token", label: "Auth Token (ถ้ามี)", target: "secret", optional: true, secret: true },
  ],
  webhook: [],
};

export default function ConnectorsPage() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [authType, setAuthType] = useState<AuthType>("api_key");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/connectors");
      const data = await res.json();
      setConnectors(data.connectors ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm() {
    setName("");
    setFieldValues({});
    setFormError(null);
  }

  async function submitCreate() {
    setSubmitting(true);
    setFormError(null);
    try {
      const config: Record<string, string> = {};
      const secret: Record<string, string> = {};
      for (const f of FIELDS_BY_TYPE[authType]) {
        const v = fieldValues[f.key];
        if (!v && !f.optional) {
          setFormError(`กรุณากรอก: ${f.label}`);
          setSubmitting(false);
          return;
        }
        if (v) (f.target === "secret" ? secret : config)[f.key] = v;
      }

      const res = await fetch("/api/admin/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, auth_type: authType, config, secret }),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error ?? "สร้างไม่สำเร็จ"); return; }

      resetForm();
      setShowForm(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function runTest(id: string) {
    setTestingId(id);
    try {
      await fetch(`/api/admin/connectors/${id}/test`, { method: "POST" });
      await load();
    } finally {
      setTestingId(null);
    }
  }

  async function removeConnector(id: string) {
    if (!confirm("ลบ Connector นี้เลยไหม?")) return;
    await fetch(`/api/admin/connectors/${id}`, { method: "DELETE" });
    await load();
  }

  async function toggleEnabled(c: Connector) {
    const res = await fetch(`/api/admin/connectors/${c.id}/enable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !c.enabled }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "เปิด/ปิดใช้งานไม่สำเร็จ");
      return;
    }
    await load();
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-stone-800">Connectors</h1>
          <p className="text-[11px] text-stone-400 mt-0.5">
            เชื่อมบริการภายนอกเข้ากับ DNA OS — ทุกบริการต้องเชื่อมผ่านหน้านี้เท่านั้น ไม่ต้องแก้โค้ด ไม่ต้อง deploy ใหม่ — ลำดับขั้นตอน: Connect → Register (อัตโนมัติ) → Test → กด Enable เองเสมอก่อน Core จะใช้งานได้
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm((v) => !v); }}
          className="text-xs px-3 py-1.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 transition font-medium shrink-0"
        >
          {showForm ? "ยกเลิก" : "+ เพิ่ม Connector"}
        </button>
      </div>

      <div className="p-6 max-w-3xl space-y-4">
        {showForm && (
          <div className="bg-white border border-stone-200 rounded-xl p-4 space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-stone-500 mb-1">ชื่อ Connector</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น n8n, GitHub, Vercel"
                className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-stone-500 mb-1">ประเภทการเชื่อมต่อ</label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(AUTH_TYPE_LABELS) as AuthType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setAuthType(t); setFieldValues({}); }}
                    className={`px-2.5 py-1 rounded-lg text-xs border transition ${
                      authType === t ? "bg-stone-800 text-white border-stone-800" : "bg-white text-stone-600 border-stone-200 hover:border-stone-400"
                    }`}
                  >
                    {AUTH_TYPE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>

            {authType === "webhook" ? (
              <p className="text-xs text-stone-500 bg-stone-50 border border-stone-200 rounded-lg p-3">
                Webhook ไม่ต้องกรอกอะไรเพิ่ม — ระบบจะสร้าง URL รับ event และ signing secret ให้อัตโนมัติหลังกดสร้าง
              </p>
            ) : (
              <div className="space-y-2.5">
                {FIELDS_BY_TYPE[authType].map((f) => (
                  <div key={f.key}>
                    <label className="block text-[11px] text-stone-500 mb-1">
                      {f.label} {f.optional && <span className="text-stone-300">(ไม่บังคับ)</span>}
                    </label>
                    <input
                      type={f.secret ? "password" : "text"}
                      value={fieldValues[f.key] ?? ""}
                      onChange={(e) => setFieldValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 focus:outline-none focus:border-stone-500 font-mono"
                    />
                  </div>
                ))}
              </div>
            )}

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <button
              onClick={submitCreate}
              disabled={submitting || !name}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40 transition"
            >
              {submitting ? "กำลังเชื่อมต่อ..." : "สร้าง + ทดสอบการเชื่อมต่อ"}
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-stone-400 text-sm">กำลังโหลด...</div>
        ) : connectors.length === 0 ? (
          <div className="text-center py-16 text-stone-400 text-sm">ยังไม่มี Connector ที่เชื่อมไว้</div>
        ) : (
          <div className="space-y-2">
            {connectors.map((c) => (
              <div key={c.id} className="bg-white border border-stone-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-stone-800">{c.name}</span>
                      <span className="text-[10px] font-mono text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">{AUTH_TYPE_LABELS[c.auth_type]}</span>
                      <StatusPill status={c.status} />
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                        c.enabled ? "text-sky-700 bg-sky-50 border-sky-200" : "text-stone-400 bg-stone-50 border-stone-200"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${c.enabled ? "bg-sky-500" : "bg-stone-300"}`} />
                        {c.enabled ? "Enabled — Core ใช้งานได้" : "ยังไม่ Enable"}
                      </span>
                    </div>
                    <div className="mt-1.5"><LifecycleSteps c={c} /></div>
                    {c.last_error && (
                      <p className="text-[11px] text-red-500 mt-1">{c.last_error}</p>
                    )}
                    {c.auth_type === "webhook" && (
                      <div className="mt-2 text-[11px] text-stone-500 space-y-0.5">
                        <div>รับ event ที่: <code className="font-mono bg-stone-100 px-1 rounded">{c.config.receiving_path}</code></div>
                      </div>
                    )}
                    {c.last_checked_at && (
                      <p className="text-[10px] text-stone-300 mt-1">
                        เช็คล่าสุด: {new Date(c.last_checked_at).toLocaleString("th-TH")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {c.auth_type === "oauth" && c.status !== "connected" && (
                      <a
                        href={`/api/connectors/oauth/authorize/${c.slug}`}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition"
                      >
                        Connect
                      </a>
                    )}
                    {c.auth_type !== "webhook" && (
                      <button
                        onClick={() => runTest(c.id)}
                        disabled={testingId === c.id}
                        className="text-[11px] px-2.5 py-1 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-40 transition"
                      >
                        {testingId === c.id ? "..." : "ทดสอบใหม่"}
                      </button>
                    )}
                    <button
                      onClick={() => toggleEnabled(c)}
                      disabled={!c.enabled && c.status !== "connected"}
                      title={!c.enabled && c.status !== "connected" ? "ต้อง Test ให้ผ่านก่อนถึงจะ Enable ได้" : undefined}
                      className={`text-[11px] px-2.5 py-1 rounded-lg transition disabled:opacity-40 ${
                        c.enabled ? "border border-stone-200 text-stone-600 hover:bg-stone-50" : "bg-sky-600 text-white hover:bg-sky-700"
                      }`}
                    >
                      {c.enabled ? "ปิดใช้งาน" : "Enable"}
                    </button>
                    <button
                      onClick={() => removeConnector(c.id)}
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition"
                    >
                      ลบ
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
