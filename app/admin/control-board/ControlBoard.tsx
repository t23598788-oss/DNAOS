"use client";

import { useCallback, useEffect, useState } from "react";

const fields = [
  { name: "cloudflare_api_token", label: "Cloudflare Token", hint: "ใช้ token ที่จำกัดสิทธิ์เท่าที่จำเป็น" },
  { name: "line_channel_access_token", label: "LINE Channel Access Token", hint: "กุญแจสำหรับส่งข้อความของ LINE" },
  { name: "kodchat_bot_token", label: "Kob Chat Bot Token", hint: "กุญแจบอทของ Kob Chat" },
  { name: "neo4j_connection_uri", label: "Neo4j Connection String", hint: "เช่น neo4j+s://host:7687 — อย่าใส่ username/password ใน URL" },
  { name: "neo4j_password", label: "Neo4j Password", hint: "ใช้คู่กับ connection string" },
  { name: "business_supabase_service_role_key", label: "Supabase Service Role Key (ฐานธุรกิจ)", hint: "ใช้กับฐานธุรกิจเท่านั้น; ห้ามใส่กุญแจของฐาน System ที่ใช้เปิด Vault นี้" },
  { name: "digitalocean_api_token", label: "DigitalOcean API Token", hint: "ใช้สำหรับ DigitalOcean Control Plane เท่านั้น; กำหนด scope อ่าน Catalog และ billing:read ตามงานที่เปิดใช้" },
] as const;

type SecretName = (typeof fields)[number]["name"];
type Metadata = { secret_name: SecretName; secret_last4: string | null; updated_at: string };

export default function ControlBoard() {
  const [metadata, setMetadata] = useState<Metadata[]>([]);
  const [values, setValues] = useState<Partial<Record<SecretName, string>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<SecretName | null>(null);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/system-vault", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; message?: string; secrets?: Metadata[] };
      if (!response.ok) throw new Error(data.message ?? "โหลดสถานะไม่ได้");
      setMetadata(data.secrets ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "โหลดสถานะไม่ได้");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function save(name: SecretName) {
    const value = values[name] ?? "";
    if (!value) return;
    setBusy(name);
    setMessage("");
    try {
      const response = await fetch("/api/admin/system-vault", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret_name: name, secret_value: value }),
      });
      const data = await response.json() as { ok?: boolean; code?: string; message?: string; secret?: Metadata };
      if (!response.ok) throw new Error(data.message ?? `บันทึกไม่สำเร็จ (${data.code ?? response.status})`);
      setValues((current) => ({ ...current, [name]: "" }));
      setMessage(`บันทึก ${fields.find((field) => field.name === name)?.label} แล้ว`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  async function remove(name: SecretName) {
    if (!window.confirm("ลบกุญแจนี้ออกจาก Vault ใช่ไหม?")) return;
    setBusy(name);
    setMessage("");
    try {
      const response = await fetch("/api/admin/system-vault", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret_name: name }),
      });
      const data = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok) throw new Error(data.message ?? "ลบไม่สำเร็จ");
      setMessage("ลบกุญแจแล้ว");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ลบไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto min-h-full max-w-4xl p-5 sm:p-8">
      <header className="mb-6 border-b border-stone-200 pb-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-stone-500">Engineering only · Secret configuration</p>
        <h1 className="mt-2 text-2xl font-bold text-stone-900">System Vault Setup</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">ตั้งค่ากุญแจฝั่งเซิร์ฟเวอร์แยกจากแผงเฝ้าระบบ กุญแจจะแสดงเป็นช่องป้อนเท่านั้น หลังบันทึกจะไม่ดึงค่าจริงกลับมาให้เบราว์เซอร์</p>
      </header>

      <aside className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <strong>แยกกุญแจฐานระบบ:</strong> กุญแจ Service Role ของฐาน System ที่ใช้เปิด Vault ต้องเก็บใน Secret ของเซิร์ฟเวอร์ที่รันแอปเท่านั้น ห้ามบันทึกกลับลง Vault ตัวเดียวกัน ช่องด้านล่างเก็บกุญแจบริการและฐานธุรกิจ เช่น DigitalOcean โดยไม่แสดงค่าจริงหลังบันทึก
      </aside>

      {message && <p role="status" className="mb-4 rounded-md bg-stone-100 px-3 py-2 text-sm text-stone-700">{message}</p>}
      {loading && <p className="mb-4 text-sm text-stone-500">กำลังอ่านสถานะการตั้งค่า…</p>}

      <section className="grid gap-4">
        {fields.map((field) => {
          const saved = metadata.find((item) => item.secret_name === field.name);
          const value = values[field.name] ?? "";
          return (
            <article key={field.name} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <label htmlFor={field.name} className="font-semibold text-stone-900">{field.label}</label>
                  <p className="mt-1 text-xs text-stone-500">{field.hint}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${saved ? "bg-emerald-50 text-emerald-800" : "bg-stone-100 text-stone-600"}`}>
                  {saved ? `ตั้งค่าแล้ว · ลงท้าย ${saved.secret_last4 ?? "••••"}` : "ยังไม่ตั้งค่า"}
                </span>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id={field.name}
                  type="password"
                  autoComplete="new-password"
                  value={value}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                  placeholder={saved ? "ป้อนค่าใหม่เพื่อเปลี่ยนกุญแจ" : "วางกุญแจที่นี่; จะไม่ถูกเก็บในเบราว์เซอร์"}
                  className="min-w-0 flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-600 focus:ring-2 focus:ring-stone-200"
                />
                <button type="button" onClick={() => void save(field.name)} disabled={!value || busy !== null} className="rounded-md bg-stone-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">
                  {busy === field.name ? "กำลังบันทึก…" : "บันทึกกุญแจ"}
                </button>
                {saved && <button type="button" onClick={() => void remove(field.name)} disabled={busy !== null} className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-40">ลบ</button>}
              </div>
            </article>
          );
        })}
      </section>

      <footer className="mt-6 rounded-lg bg-stone-100 p-4 text-xs leading-5 text-stone-600">
        ค่ากุญแจถูกส่งผ่าน API ฝั่งเซิร์ฟเวอร์และเก็บใน Supabase Vault ของฐาน System เมื่อฐานนี้ถูกติดตั้งและกำหนดค่าแล้ว ระบบเก็บเฉพาะชื่อกุญแจ วันที่ปรับปรุง และตัวอักษร 4 ตัวท้ายไว้ในรายการสถานะ
      </footer>
    </main>
  );
}
