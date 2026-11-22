"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUpRight, Box, Cpu, Database, PlugZap, Server, ShieldCheck } from "lucide-react";
import { EXTERNAL_SERVICE_CATALOG, type ExternalServiceCatalogEntry } from "@/registry/external-service-catalog";

type Connection = {
  id: string;
  provider_id: string;
  connection_method: "oauth" | "api_key" | "mcp";
  external_account_id: string | null;
  account_label: string | null;
  granted_scopes: string[];
  status: "pending" | "connected" | "error" | "revoked";
  last_verified_at: string | null;
  last_error_code: string | null;
};
type ConnectionsResponse = { ok?: boolean; connections?: Connection[] };
type ConnectionMutationResponse = { ok?: boolean; code?: string; status?: string };

const GROUPS = [
  { id: "runtime", title: "การประมวลผลของ DNA OS", detail: "บริการที่ DNA OS ใช้จัดการระบบและประมวลผล", icon: Cpu },
  { id: "external", title: "บริการภายนอก", detail: "บริการสำเร็จรูปที่เชื่อมกับบัญชีผู้ใช้ตามสิทธิ์ที่อนุมัติ", icon: Box },
  { id: "mcp", title: "MCP และปลั๊กอิน", detail: "เครื่องมือภายนอกที่ทำงานผ่าน protocol และขอบเขตสิทธิ์ของผู้ให้บริการ", icon: PlugZap },
] as const;

export default function ConnectionsCatalogClient({ userEmail }: { userEmail: string }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationReady, setMigrationReady] = useState(false);
  const byProvider = useMemo(() => {
    const map = new Map<string, Connection[]>();
    for (const item of connections) map.set(item.provider_id, [...(map.get(item.provider_id) ?? []), item]);
    return map;
  }, [connections]);

  useEffect(() => {
    let active = true;
    fetch("/api/account/connections", { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json().catch(() => ({})) as ConnectionsResponse }))
      .then(({ response, body }) => {
        if (!active) return;
        setMigrationReady(response.ok && body.ok === true);
        setConnections(body.connections ?? []);
      })
      .catch(() => { if (active) setMigrationReady(false); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
          <div>
            <a href="/workspace" className="text-xs font-semibold tracking-[0.16em] text-slate-400">← กลับพื้นที่ทำงาน DNA OS</a>
            <h1 className="mt-1 text-2xl font-semibold">บริการและปลั๊กอิน</h1>
            <p className="mt-1 text-sm text-slate-500">ทางเข้ากลางสำหรับบริการที่ DNA OS ประมวลผลและบัญชีบริการที่คุณเลือกเชื่อม</p>
          </div>
          <span className="max-w-[18rem] truncate rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800" title={userEmail}>บัญชีนี้ · {userEmail}</span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-8 px-5 py-8">
        <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
            <div>
              <h2 className="text-sm font-semibold text-sky-950">บัญชีบริการแยกตามผู้ใช้</h2>
              <p className="mt-1 text-sm leading-6 text-sky-900/80">
                ข้อมูลการเชื่อมต่อจะแยกตามบัญชีที่ล็อกอิน ตอนนี้ช่อง API key รองรับเฉพาะการตรวจและเก็บคีย์ของ OpenAI, Anthropic และ Gemini; ยังไม่ได้ต่อคีย์เหล่านี้เข้ากับการเรียก AI ของระบบ ส่วน OAuth และ MCP จะแสดงเมื่อมีทางเชื่อมและขอบเขตสิทธิ์ที่ตรวจสอบได้
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <h2 className="font-semibold">แยกชั้นข้อมูล บัญชีปลั๊กอิน และการประมวลผล</h2>
            <p className="mt-1 text-sm text-slate-500">แนวทางของระบบกับสถานะที่ยืนยันได้จากซอร์สโค้ดปัจจุบัน</p>
          </div>
          <ol className="grid gap-3 md:grid-cols-4">
            <LayerCard icon={ShieldCheck} title="บัญชี DNA OS" text="ยืนยันผู้ใช้ก่อนเข้าหน้าจัดการบริการ" state="ใช้อยู่ในระบบ" />
            <LayerCard icon={Database} title="Supabase" text="เก็บตัวตนและข้อมูลอ้างอิงการเชื่อมต่อ; คีย์ API ที่เพิ่มผ่านหน้านี้ใช้ Vault" state="ฐานข้อมูลเดิม · migration ยังไม่ติดตั้ง" />
            <LayerCard icon={PlugZap} title="DNA OS Connector Gateway" text="รวมปลั๊กอิน ตรวจสิทธิ์ แยกบัญชีผู้ใช้ และควบคุมขั้น Connect → Register → Test → Enable → Run" state="กฎกลางมีอยู่ · การรันแบบแยกผู้ใช้ยังต้องต่อเพิ่ม" />
            <LayerCard icon={Server} title="DigitalOcean Compute" text="ชั้นประมวลผลเป้าหมาย งานต้องเข้าผ่าน gateway โดยไม่เปิด credential ให้เบราว์เซอร์" state="มี AI Worker/IDE adapter · ยังไม่ใช่ AI Gateway หลัก" />
          </ol>
          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            ลำดับเป้าหมาย: บัญชีผู้ใช้ → ข้อมูลอ้างอิงใน Supabase → DNA OS ตรวจสิทธิ์และเลือกปลั๊กอิน → ส่งงานประมวลผลไป DigitalOcean → ส่งผลกลับผ่าน DNA OS
          </div>
        </section>

        {!migrationReady && !loading && (
          <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            ทะเบียนการเชื่อมต่อรายผู้ใช้ยังไม่พร้อมใช้งานบนฐานข้อมูลนี้ จึงยังไม่แสดงสถานะเชื่อมต่อ
          </section>
        )}

        {GROUPS.map((group) => {
          const Icon = group.icon;
          const entries = EXTERNAL_SERVICE_CATALOG.filter((item) => item.serviceClass === group.id);
          return (
            <section key={group.id}>
              <div className="mb-3 flex items-start gap-3">
                <div className="rounded-xl bg-white p-2 text-slate-600 shadow-sm"><Icon className="h-5 w-5" /></div>
                <div>
                  <h2 className="font-semibold">{group.title}</h2>
                  <p className="text-sm text-slate-500">{group.detail}</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {entries.map((entry) => (
                  <ServiceCard key={entry.id} entry={entry} connections={byProvider.get(entry.id) ?? []} loading={loading} migrationReady={migrationReady} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

function LayerCard({ icon: Icon, title, text, state }: {
  icon: typeof Cpu;
  title: string;
  text: string;
  state: string;
}) {
  return (
    <li className="relative rounded-xl border border-slate-200 p-3">
      <div className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-sky-700" />{title}</div>
      <p className="mt-2 text-xs leading-5 text-slate-600">{text}</p>
      <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] font-medium text-amber-800">{state}</p>
      <ArrowDown className="absolute -bottom-4 left-1/2 z-10 h-4 w-4 translate-x-[-50%] text-slate-300 md:hidden" />
    </li>
  );
}

function ServiceCard({ entry, connections, loading, migrationReady }: {
  entry: ExternalServiceCatalogEntry;
  connections: Connection[];
  loading: boolean;
  migrationReady: boolean;
}) {
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [connectedNow, setConnectedNow] = useState<boolean | null>(null);
  const ready = entry.userConnection !== "not_implemented";
  const apiKeyMode = entry.userConnection === "api_key";
  const oauthConnections = connections.filter((item) => item.connection_method === "oauth" && item.status === "connected");
  const connected = connectedNow ?? (oauthConnections.length > 0 || connections.some((item) => item.status === "connected"));

  async function saveApiKey() {
    setSavingKey(true);
    setConnectionMessage("");
    try {
      const response = await fetch(`/api/account/connections/${encodeURIComponent(entry.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey }),
      });
      const body = await response.json().catch(() => ({})) as ConnectionMutationResponse;
      if (!response.ok || body.ok !== true) {
        const messages: Record<string, string> = {
          PROVIDER_CREDENTIAL_REJECTED: "ผู้ให้บริการปฏิเสธคีย์นี้ ตรวจคีย์และสิทธิ์ของมันอีกครั้ง",
          PROVIDER_UNREACHABLE: "ติดต่อผู้ให้บริการไม่ได้ ลองใหม่ภายหลัง",
          CREDENTIAL_STORE_UNAVAILABLE: "ที่เก็บ credential ยังไม่พร้อม",
          USER_CONNECTIONS_NOT_MIGRATED: "ทะเบียนบัญชีผู้ใช้ยังไม่ถูกติดตั้ง",
        };
        setConnectionMessage(messages[body.code ?? ""] ?? "บันทึกและตรวจสอบไม่สำเร็จ");
        return;
      }
      setApiKey("");
      setConnectedNow(true);
      setConnectionMessage("ตรวจคีย์ผ่านและบันทึกไว้สำหรับบัญชีนี้แล้ว; ยังไม่ได้ต่อคีย์เข้ากับ AI runtime");
    } catch {
      setConnectionMessage("ระบบเชื่อมต่อไม่สำเร็จ ลองใหม่ภายหลัง");
    } finally {
      setSavingKey(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setConnectionMessage("");
    try {
      const response = await fetch(`/api/account/connections/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({})) as ConnectionMutationResponse;
      if (!response.ok || body.ok !== true) {
        setConnectionMessage("ตัดการเชื่อมต่อไม่สำเร็จ ลองใหม่ภายหลัง");
        return;
      }
      setConnectedNow(false);
      setConnectionMessage("ตัดการเชื่อมต่อบัญชีนี้แล้ว");
    } catch {
      setConnectionMessage("ระบบเชื่อมต่อไม่สำเร็จ ลองใหม่ภายหลัง");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-11 min-w-11 items-center justify-center rounded-xl bg-slate-900 px-2 text-xs font-bold tracking-wide text-white">{entry.mark}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{entry.name}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${ready ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
              {loading ? "กำลังอ่านสถานะ" : entry.serviceClass === "runtime" ? "ชั้นประมวลผลฝั่งระบบ" : connected && !apiKeyMode ? "เชื่อมบัญชีแล้ว" : connected ? "ตรวจคีย์ผ่านและเก็บไว้แล้ว · ยังไม่ต่อกับ AI runtime" : ready && migrationReady ? (apiKeyMode ? "พร้อมตรวจคีย์ API" : "พร้อมเชื่อม OAuth") : "กำลังเตรียมการเชื่อมบัญชีรายบุคคล"}
            </span>
          </div>
          <p className="mt-1 text-sm leading-5 text-slate-600">{entry.description}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        {entry.sourceUrl ? (
          <a href={entry.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-sky-700 hover:text-sky-900">
            {entry.sourceLabel}<ArrowUpRight className="h-4 w-4" />
          </a>
        ) : <span className="text-sm text-slate-500">{entry.sourceLabel}</span>}
        {!ready && entry.serviceClass !== "runtime" && <span className="text-xs text-slate-400">ยังไม่เปิดเชื่อมจากบัญชีส่วนตัว</span>}
      </div>
      {ready && apiKeyMode && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <label className="block text-xs font-medium text-slate-600" htmlFor={`key-${entry.id}`}>API key ของบัญชีผู้ใช้</label>
          <div className="flex gap-2">
            <input
              id={`key-${entry.id}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              disabled={!migrationReady || savingKey}
              placeholder={connected ? "ใส่คีย์ใหม่เพื่อเปลี่ยนคีย์เดิม" : "วาง API key ที่สร้างจากผู้ให้บริการ"}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-500 disabled:bg-slate-50"
            />
            <button
              onClick={saveApiKey}
              disabled={!migrationReady || savingKey || apiKey.length < 8}
              className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {savingKey ? "กำลังตรวจ..." : connected ? "ตรวจและเปลี่ยนคีย์" : "ตรวจและบันทึกคีย์"}
            </button>
          </div>
          <p className="text-[11px] leading-5 text-slate-500">คีย์จะไม่แสดงกลับหลังบันทึก ระบบตรวจการอ่านรายการโมเดลก่อนเก็บไว้ใน Vault ฝั่งเซิร์ฟเวอร์ การตรวจนี้ไม่ยืนยัน scope อื่นของคีย์</p>
          {connectionMessage && <p role="status" className="text-xs text-slate-600">{connectionMessage}</p>}
          {connected && <button onClick={disconnect} disabled={disconnecting || savingKey} className="text-xs font-medium text-rose-700 hover:text-rose-900 disabled:opacity-50">{disconnecting ? "กำลังตัดการเชื่อมต่อ..." : "ตัดการเชื่อมต่อบัญชีนี้"}</button>}
        </div>
      )}
      {ready && !apiKeyMode && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <button type="button" disabled={!migrationReady || loading} onClick={() => { window.location.assign(`/api/account/connections/oauth/${encodeURIComponent(entry.id)}`); }} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
            {oauthConnections.length ? "เพิ่มบัญชีอีกบัญชี" : "เชื่อมบัญชีในคลิกเดียว"}<ArrowUpRight className="h-4 w-4" />
          </button>
          <p className="text-[11px] leading-5 text-slate-500">จะเปิดหน้าผู้ให้บริการให้คุณเข้าสู่ระบบและอนุมัติสิทธิ์ จากนั้นกลับมาหน้านี้โดยอัตโนมัติ token ถูกเก็บฝั่งเซิร์ฟเวอร์แยกตามบัญชีผู้ใช้</p>
          {connections.filter((item) => item.connection_method === "oauth" && item.status === "connected").map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <span className="min-w-0 truncate">{item.account_label || item.external_account_id} · scope {item.granted_scopes.length ? item.granted_scopes.join(", ") : "ผู้ให้บริการไม่ส่งรายการ scope กลับมา"}</span>
              <button onClick={async () => {
                const response = await fetch(`/api/account/connections/${encodeURIComponent(entry.id)}?connection_id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
                const body = await response.json().catch(() => ({})) as ConnectionMutationResponse;
                if (response.ok && body.ok) {
                  setConnectionMessage("ลบ token นี้ออกจาก DNA OS แล้ว; หากต้องการยกเลิกสิทธิ์ที่ผู้ให้บริการ ให้ยกเลิกจากหน้าบัญชีผู้ให้บริการด้วย");
                  window.setTimeout(() => window.location.reload(), 500);
                } else setConnectionMessage("ลบการเชื่อมต่อไม่สำเร็จ");
              }} className="shrink-0 text-rose-700">ลบการเชื่อมต่อ</button>
            </div>
          ))}
          {connectionMessage && <p role="status" className="text-xs text-slate-600">{connectionMessage}</p>}
        </div>
      )}
    </article>
  );
}
