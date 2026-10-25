"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Devices board (2026-09-25) — admin surface for paired device executors.
 * Data source = /api/admin/devices ONLY (metadata; token never leaves server).
 * Includes the per-channel capability matrix (rule2: ห้ามบอกว่าทุกช่องทางทำ
 * ได้เท่ากัน — each row carries its real status + reason + fix steps).
 */
interface DeviceRow {
  id: string;
  device_name: string;
  paired_email: string;
  paired_role: string;
  status: "paired" | "revoked";
  grants: string[];
  os: string | null;
  os_release: string | null;
  arch: string | null;
  cpu_count: number | null;
  ram_bytes: number | null;
  disk_free_bytes: number | null;
  node_version: string | null;
  tools: Record<string, unknown>;
  pending_probe: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
  has_token: boolean;
}

interface ChannelRow {
  channel: string;
  capability: string;
  status: "READY" | "UNVERIFIED" | "BLOCKED";
  reason: string;
  steps?: string;
}

const CHANNEL_MATRIX: ChannelRow[] = [
  { channel: "เบราว์เซอร์", capability: "งานธุรกิจตามสิทธิ์บัญชี (เอกสาร/การเงิน/LINE)", status: "READY", reason: "ล็อกอิน SSO + ทุก API เช็คสิทธิ์ฝั่ง server แล้ว" },
  { channel: "PWA (แอปติดตั้ง)", capability: "งานธุรกิจตามสิทธิ์บัญชี", status: "READY", reason: "เหมือนเบราว์เซอร์ + ไอคอน/แคช static — ไม่เพิ่มสิทธิ์เครื่อง", steps: "ดูวิธีติดตั้งที่หน้า /install" },
  { channel: "Desktop (Tauri)", capability: "แอปเดสก์ท็อป", status: "UNVERIFIED", reason: "มี config (src-tauri) แต่ยังไม่มี build artifact + ต้องผ่าน signing/notarization (Owner) — ยังไม่แจก", steps: "ใช้เบราว์เซอร์/PWA ไปก่อน" },
  { channel: "Device connector", capability: "จับคู่เครื่อง + รายงาน OS/CPU/RAM/ดิสก์", status: "READY", reason: "selftest รันจริงบน macOS (keychain roundtrip ok)", steps: "สร้างโค้ดที่หน้านี้ → node dnaos-device.mjs pair <code> --server <url>" },
  { channel: "Device connector", capability: "อ่านรายชื่อเครื่องพิมพ์ (probe)", status: "UNVERIFIED", reason: "โค้ด + allowlist พร้อม; ทดสอบแล้วบน macOS — Windows/Linux ยังไม่มีเครื่องทดสอบ (UNVERIFIED)", steps: "กด Probe หลังเครื่องคู่แล้ว" },
  { channel: "Device connector", capability: "สั่งพิมพ์เอกสารอัตโนมัติจากคิว", status: "BLOCKED", reason: "print_jobs ยังไม่มี URL ไฟล์พิมพ์สำเร็จใน contract (มีแค่ media_path รูปต้นทาง) — executor ปัจจุบันคือ print-watcher บนเครื่อง Owner เท่านั้น", steps: "ช่องว่าง: เพิ่ม printable artifact URL ใน contract ของ print_jobs ก่อนเปิดคำสั่งพิมพ์บนเครื่องผู้ใช้" },
  { channel: "Device connector", capability: "รันคำสั่ง shell อิสระ", status: "BLOCKED", reason: "จงใจไม่ทำ — allowlist ปิดรับเฉพาะ probe_printers (argv array ไม่มี shell) เพื่อไม่เปิดช่องรับคำสั่งจากเว็บ" },
];

const STATUS_STYLE: Record<ChannelRow["status"], string> = {
  READY: "bg-emerald-50 text-emerald-700 border-emerald-200",
  UNVERIFIED: "bg-amber-50 text-amber-700 border-amber-200",
  BLOCKED: "bg-red-50 text-red-700 border-red-200",
};

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n / 1e9).toFixed(1)} GB`;
}
function fmtTime(ts: string | null): string {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" }); } catch { return "—"; }
}

export default function DevicesBoard() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [migrated, setMigrated] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState<{ code: string; expires_at: string } | null>(null);
  const [note, setNote] = useState("");
  // step6 — owner's view: which tool has which grant, which job is running,
  // revoke grants, stop/cancel jobs. Data from the two admin policy routes.
  const [grants, setGrants] = useState<Record<string, unknown>[]>([]);
  const [commands, setCommands] = useState<Record<string, unknown>[]>([]);
  const [policyNote, setPolicyNote] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [g, c] = await Promise.all([
          fetch("/api/admin/devices/grants", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
          fetch("/api/admin/devices/commands", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        ]);
        if (g?.ok) setGrants(g.grants as Record<string, unknown>[]);
        else if (g?.code === "META_TABLES_MISSING") setPolicyNote("ตาราง policy ยังไม่ถูก apply — รัน migration 20260926000001 (รอ Owner อนุมัติรอบ release)");
        if (c?.ok) setCommands(c.commands as Record<string, unknown>[]);
      } catch { /* banner via policyNote on failure paths above */ }
    })();
  }, []);

  async function revokeGrant(id: string) {
    if (!window.confirm("เพิกถอนสิทธิ์นี้? การกระทำที่ยังไม่มี grant จะถูกปฏิเสธทันที")) return;
    const res = await fetch("/api/admin/devices/grants", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "revoke", id }),
    });
    const json = await res.json().catch(() => ({}));
    setPolicyNote(res.ok && json.ok ? "เพิกถอนสิทธิ์แล้ว · audit ✓" : `เพิกถอนไม่สำเร็จ: ${json.error ?? res.status}`);
    if (res.ok && json.ok) setGrants((prev) => prev.map((x) => (x.id === id ? { ...x, revoked_at: new Date().toISOString() } : x)));
  }

  async function cmdOp(cmdId: string, op: "cancel" | "requeue") {
    const res = await fetch(`/api/admin/devices/commands/${cmdId}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op }),
    });
    const json = await res.json().catch(() => ({}));
    setPolicyNote(res.ok && json.ok ? `${op} สำเร็จ · audit ✓` : `${op} ไม่สำเร็จ: ${json.error ?? res.status}`);
    if (res.ok && json.ok) {
      setCommands((prev) => prev.map((x) => (x.id === cmdId ? { ...(json.command as Record<string, unknown>) } : x)));
    }
  }


  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/devices", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? `${res.status}`);
      setDevices(json.devices as DeviceRow[]);
      setMigrated(Boolean(json.migrated));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createCode() {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/admin/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_name: deviceName }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setNote(json.code === "META_TABLES_MISSING" ? `ยังไม่พร้อม: ${json.error}` : `สร้างโค้ดไม่สำเร็จ: ${json.error ?? res.status}`);
        return;
      }
      setPairing({ code: json.code, expires_at: json.expires_at });
      setDeviceName("");
      await load();
    } catch (e) {
      setNote(`สร้างโค้ดไม่สำเร็จ: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  }

  async function probe(d: DeviceRow) {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/devices/${d.id}/probe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "probe_printers" }),
      });
      const json = await res.json();
      setNote(res.ok && json.ok
        ? "สั่ง probe แล้ว — เครื่องจะรายงานผลในการ heartbeat รอบถัดไป (≤30วิ)"
        : `probe ไม่สำเร็จ: ${json.error ?? res.status}`);
      await load();
    } finally { setBusy(false); }
  }

  async function revoke(d: DeviceRow) {
    if (!window.confirm(`เพิกถอนอุปกรณ์ "${d.device_name}"? Token จะถูกปิดทันทีที่เซิร์ฟเวอร์`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/devices/${d.id}`, { method: "DELETE" });
      const json = await res.json();
      setNote(res.ok && json.ok ? `เพิกถอน ${d.device_name} แล้ว` : `เพิกถอนไม่สำเร็จ: ${json.error ?? res.status}`);
      await load();
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-5 space-y-5">
      {migrated === false && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          ตาราง device_registry ยังไม่ถูก apply บนฐานข้อมูลแอป — ขั้นตอนของ Owner: รัน
          <span className="font-mono"> migration 20260925000001_device_registry</span> บนฐานข้อมูล production
          (รอตรวจ UI + อนุมัติรอบ release เท่านั้น) หลัง apply หน้านี้ใช้งานได้เต็มรูปแบบ
        </div>
      )}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</div>}
      {note && <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-xs text-stone-700">{note}</div>}

      <section className="rounded-xl border border-[#E9E1D6] bg-[#FDFBF8] p-4">
        <h2 className="text-sm font-semibold text-stone-800">เพิ่มอุปกรณ์ (สร้างโค้ดจับคู่)</h2>
        <p className="mt-1 text-[11px] text-stone-500">
          โค้ดอายุ10นาทีใช้ได้1ครั้ง — เครื่องเอาโค้ดไปแลก <b>token ของตัวเอง</b> เก็บใน Keychain/DPAPI/libsecret
          (ไม่มี owner/admin/service-role secret ลงเครื่องผู้ใช้)
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="ชื่ออุปกรณ์ เช่น คอมพิวเตอร์แผนกบัญชี"
            className="w-72 rounded-lg border border-stone-200 px-3 py-2 text-xs focus:border-stone-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void createCode()}
            disabled={busy || !deviceName.trim()}
            className="rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white hover:bg-stone-800 disabled:opacity-40"
          >
            สร้างโค้ดจับคู่
          </button>
        </div>
        {pairing && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-[11px] text-emerald-800">แสดงครั้งเดียว — นำไปรันบนเครื่องผู้ใช้:</p>
            <code className="mt-1 block rounded bg-white px-3 py-2 font-mono text-sm text-stone-800 select-all">
              node dnaos-device.mjs pair {pairing.code} --server {typeof window !== "undefined" ? window.location.origin : "<โดเมนแอป>"}
            </code>
            <p className="mt-1 text-[10px] text-emerald-700">
              หมดอายุ {fmtTime(pairing.expires_at)} · วิธีติดตั้งราย OS:{" "}
              <a className="underline" href="/install" target="_blank" rel="noreferrer">/install</a>
            </p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[#E9E1D6] bg-[#FDFBF8] p-4">
        <h2 className="text-sm font-semibold text-stone-800">อุปกรณ์ ({devices.length})</h2>
        {devices.length === 0 && migrated !== false && (
          <p className="mt-2 text-xs text-stone-400">ยังไม่มีอุปกรณ์ที่จับคู่</p>
        )}
        <div className="mt-3 space-y-3">
          {devices.map((d) => {
            const tools = d.tools as { printers?: string[] };
            const printers = Array.isArray(tools.printers) ? tools.printers : [];
            const stale = d.last_seen_at ? Date.now() - new Date(d.last_seen_at).getTime() > 2 * 60_000 : true;
            return (
              <div key={d.id} className="rounded-lg border border-stone-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-stone-800">{d.device_name}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] ${d.status === "revoked" ? "border-red-200 bg-red-50 text-red-700" : stale ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                      {d.status === "revoked" ? "เพิกถอนแล้ว" : stale ? "ออฟไลน์?" : "ออนไลน์"}
                    </span>
                    <span className="font-mono text-[10px] text-stone-400">{d.id.slice(0, 8)}</span>
                  </div>
                  <div className="flex gap-1.5">
                    {d.status === "paired" && (
                      <>
                        <button type="button" onClick={() => void probe(d)} disabled={busy}
                          className="rounded border border-stone-300 px-2 py-1 text-[11px] hover:bg-stone-50 disabled:opacity-40">
                          Probe เครื่องพิมพ์
                        </button>
                        <button type="button" onClick={() => void revoke(d)} disabled={busy}
                          className="rounded border border-red-200 px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-40">
                          เพิกถอน
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-stone-600 sm:grid-cols-4">
                  <span>บัญชี: {d.paired_email} <span className="text-stone-400">({d.paired_role})</span></span>
                  <span>OS: {d.os ?? "—"} {d.arch ?? ""}</span>
                  <span>CPU/RAM: {d.cpu_count ?? "—"}-core · {fmtBytes(d.ram_bytes)}</span>
                  <span>ดิสก์ว่าง: {fmtBytes(d.disk_free_bytes)} · Node {d.node_version ?? "—"}</span>
                  <span>seen: {fmtTime(d.last_seen_at)}{d.pending_probe ? ` · probe:${d.pending_probe}` : ""}</span>
                  <span>release: {d.os_release ?? "—"}</span>
                  <span className="col-span-2">grants: {d.grants.join(", ") || "—"}</span>
                </div>
                <div className="mt-2 text-[11px] text-stone-600">
                  เครื่องพิมพ์ที่รายงาน:{" "}
                  {printers.length > 0 ? printers.join(", ") : <span className="text-stone-400">ยังไม่มี — กด Probe แล้วรอ heartbeat</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-[#E9E1D6] bg-[#FDFBF8] p-4">
        <h2 className="text-sm font-semibold text-stone-800">ช่องทาง × ความสามารถ (ตามหลักฐานจริง)</h2>
        <div className="mt-3 space-y-2">
          {CHANNEL_MATRIX.map((r) => (
            <div key={`${r.channel}-${r.capability}`} className="rounded-lg border border-stone-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold text-stone-600">{r.channel}</span>
                <span className="text-xs font-medium text-stone-800">{r.capability}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[r.status]}`}>{r.status}</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-stone-500">{r.reason}</p>
              {r.steps && <p className="mt-0.5 text-[11px] text-stone-400">→ {r.steps}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-[#E9E1D6] bg-[#FDFBF8] p-4">
        <h2 className="text-sm font-semibold text-stone-800">Policy &amp; Jobs — สิทธิ์ · คำสั่ง · โหมดการควบคุม</h2>
        {policyNote && <p className="mt-2 rounded-lg bg-stone-100 px-2 py-1.5 text-[11px] text-stone-700">{policyNote}</p>}

        {/* modes — honest split (owner step5): never PROTECTED without enforcement */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-[11px] font-bold text-emerald-800">โหมด MANAGED-TOOL — มีบังคับจริง (macOS วัดแล้ว)</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-emerald-700">
              <li>executable allowlist (code-locked · /bin/echo ถูกปฏิเสธ exit4)</li>
              <li>env scrub ไม่มี secret แม่หลุดถึงเครื่องมือ (hasSecret:false)</li>
              <li>path arg ต้องอยู่ใน workspace (symlink/abs escape → exit3)</li>
              <li>CPU limit (ulimit -t → kill2วิ exit1 วัดแล้ว)</li>
              <li>เครือข่ายออกนอก: sandbox deny network* (NET-DENIED วัดแล้ว)</li>
            </ul>
            <p className="mt-1 text-[10px] text-emerald-900">รันเฉพาะ process ที่ผ่าน runner: <code className="font-mono">local-runtime/managed/managed-tool-runner.mjs</code></p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-[11px] font-bold text-red-800">โหมด จัดการทั้งเครื่อง — NOT ENABLED (ยังไม่เปิดบนเครื่องหลัก)</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-red-700">
              <li><b>ยังมีช่องโหว่:</b> อ่านไฟล์นอก workspace ผ่านสคริปต์ยังได้ (profile เต็ม abort/hang บน Darwin27) — ห้ามเรียกสถานะนี้ว่า PROTECTED</li>
              <li>โปรแกรมที่เปิดนอก runner = <b>UNMANAGED</b> เสมอ (daemons เก่า, browser, terminal)</li>
              <li>ต้องใช้: macOS = MDM+Endpoint Security (Apple/MDM ของ Owner) · Windows = AppLocker/CIG (admin+edition) · Linux = AppArmor/SELinux (root)</li>
              <li>policy ทดสอบใน VM/เครื่องทดสอบก่อน — AI แก้ policy เองไม่ได้ (grant เขียนได้เฉพาะ route นี้ด้วย session เจ้าของ)</li>
            </ul>
          </div>
        </div>

        {/* grants */}
        <h3 className="mt-4 text-xs font-semibold text-stone-700">สิทธิ์ที่ให้ไว้ ({grants.length})</h3>
        <div className="mt-1 space-y-1">
          {grants.length === 0 && <p className="text-[11px] text-stone-400">ยังไม่มี grant (ยังไม่มีคำสั่งเครื่องมือใดได้รับอนุญาต — deny-by-default)</p>}
          {grants.map((g) => {
            const revoked = Boolean(g.revoked_at);
            return (
              <div key={String(g.id)} className={`flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1.5 text-[11px] ${revoked ? "border-stone-200 bg-stone-50 text-stone-400 line-through" : "border-stone-200 bg-white text-stone-700"}`}>
                <span className="font-mono">{String(g.subject_type)}:{String(g.subject_id).slice(0, 8)} · {String(g.action)} · {String(g.resource)}{g.expires_at ? ` · หมด ${fmtTime(String(g.expires_at))}` : " · ไม่หมดอายุ"}{g.job_id ? " · job-bound" : ""}</span>
                {!revoked && (
                  <button type="button" onClick={() => void revokeGrant(String(g.id))} className="rounded border border-red-200 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50">เพิกถอน</button>
                )}
              </div>
            );
          })}
        </div>

        {/* commands */}
        <h3 className="mt-4 text-xs font-semibold text-stone-700">งาน/คำสั่งล่าสุด ({commands.length}) — ความสำเร็จมาเฉพาะ result ack เท่านั้น</h3>
        <div className="mt-1 space-y-1">
          {commands.length === 0 && <p className="text-[11px] text-stone-400">ยังไม่มีคำสั่ง (ยังไม่มี migration/คำสั่งถูกสร้าง)</p>}
          {commands.map((c) => {
            const st = String(c.status);
            const canCancel = st === "dispatched" || st === "running";
            const canRequeue = st === "failed";
            return (
              <div key={String(c.id)} className="flex flex-wrap items-center justify-between gap-2 rounded border border-stone-200 bg-white px-2 py-1.5 text-[11px]">
                <span className="font-mono text-stone-600">
                  {String(c.command_kind)}{(c.payload as { tool_id?: string } | null)?.tool_id ? `(${String((c.payload as { tool_id?: string }).tool_id)})` : ""} · <b>{st}</b> · attempt {String(c.attempts)}/{String(c.max_attempts)} · {String(c.device_name ?? "?")} · exp {fmtTime(String(c.expires_at))}{c.finished_at ? ` · done ${fmtTime(String(c.finished_at))}` : ""}
                </span>
                <span className="flex gap-1">
                  {canCancel && <button type="button" onClick={() => void cmdOp(String(c.id), "cancel")} className="rounded border border-red-200 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50">หยุดงาน</button>}
                  {canRequeue && <button type="button" onClick={() => void cmdOp(String(c.id), "requeue")} className="rounded border border-amber-200 px-1.5 py-0.5 text-[10px] text-amber-700 hover:bg-amber-50">ลองใหม่</button>}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}




