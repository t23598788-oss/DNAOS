"use client";

/**
 * PUBLIC REGISTRATION FORM (/pub/register) — owner directive 2026-10-15
 *
 * ฟอร์มลงทะเบียนนั่งเอง (PHASE 2): บุคคล / บริษัท / ผู้ผลิตและผู้จำหน่าย /
 * เจ้าของทรัพยากร / ผู้ให้บริการขนส่ง / แรงงาน / ผู้ต้องการซื้อ-ใช้ทรัพยากร
 * ผ่าน auth เดิมจริง — เส้น POST /api/public/register → magic-link action_link
 * (ระบบไม่ส่งข้อความ/อีเมลจริงใด ๆ จากเส้นนี้ — ผู้ลงทะเบียนกดลิงก์เอง)
 * ไฟล์ใหม่แยก path — ไม่แตะหน้า admin/workspace เดิม
 */
import { useState } from "react";

const PROFILES: { key: string; label: string }[] = [
  { key: "buyer", label: "ผู้ต้องการซื้อ/ใช้ทรัพยากร" },
  { key: "resource_owner", label: "เจ้าของทรัพยากร (บ่อ/โกดัง/แหล่งผลิต)" },
  { key: "service_provider", label: "ผู้ผลิต/จำหน่ายวัสดุ" },
  { key: "transporter", label: "ผู้ให้บริการขนส่ง (คนขับ/รถบรรทุก)" },
  { key: "labor", label: "แรงงาน" },
];

export default function PublicRegisterPage() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [profile, setProfile] = useState("buyer");
  const [isCompany, setIsCompany] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; link?: string } | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiOut, setAiOut] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/public/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          display_name: displayName,
          registration_type: isCompany ? "company" : "individual",
          company_name: isCompany ? companyName : undefined,
          phone,
          registrant_profile: profile,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; action_link?: string };
      if (json.ok) {
        setResult({ ok: true, message: "ลงทะเบียนสำเร็จ — กดลิงก์เข้าระบบเพื่อตั้งค่าต่อ", link: json.action_link });
      } else {
        setResult({ ok: false, message: json.error ?? "ลงทะเบียนไม่สำเร็จ" });
      }
    } catch {
      setResult({ ok: false, message: "เชื่อมต่อระบบไม่ได้ตอนนี้ กรุณาลองใหม่" });
    } finally {
      setBusy(false);
    }
  }

  async function askAi() {
    if (!aiText.trim()) return;
    setAiOut("กำลังแยกข้อมูล…");
    try {
      const res = await fetch("/api/public/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: aiText }),
      });
      const json = (await res.json()) as {
        ok?: boolean; suggestion?: { fields?: Record<string, unknown>; missing_required?: string[]; notes?: string[] }; error?: string;
      };
      if (json.ok && json.suggestion) {
        setAiOut(JSON.stringify(json.suggestion, null, 2));
      } else {
        setAiOut(json.error ?? "ไม่สามารถแยกข้อมูลได้");
      }
    } catch {
      setAiOut("เชื่อมต่อระบบไม่ได้ตอนนี้");
    }
  }

  return (
    <main style={{ maxWidth: 620, margin: "2rem auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.4rem" }}>ลงทะเบียนผู้ใช้/ทรัพยากร — ทะเบียนกลาง (DNA OS)</h1>
      <p style={{ color: "#555", fontSize: "0.9rem" }}>
        ระบบจะออกลิงก์เข้าระบบครั้งเดียวให้คุณกดเอง (ไม่มีระบบส่งอีเมลจากเส้นทางนี้ในขั้นนี้)
      </p>
      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: "1rem" }}>
        <label>อีเมล<br /><input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%", padding: "0.45rem" }} /></label>
        <br />
        <label>ชื่อที่ใช้แสดง<br /><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={{ width: "100%", padding: "0.45rem" }} /></label>
        <br />
        <label>ประเภทผู้ลงทะเบียน<br />
          <select value={profile} onChange={(e) => setProfile(e.target.value)} style={{ width: "100%", padding: "0.45rem" }}>
            {PROFILES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label style={{ display: "block", marginTop: "0.6rem" }}>
          <input type="checkbox" checked={isCompany} onChange={(e) => setIsCompany(e.target.checked)} /> ลงทะเบียนเป็นนิติบุคคล/บริษัท
        </label>
        {isCompany && (
          <label>ชื่อบริษัท/ผู้ประกอบการ<br /><input value={companyName} onChange={(e) => setCompanyName(e.target.value)} style={{ width: "100%", padding: "0.45rem" }} /></label>
        )}
        <label>เบอร์ติดต่อ<br /><input value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: "100%", padding: "0.45rem" }} /></label>
        <button type="button" onClick={submit} disabled={busy || !email} style={{ marginTop: "0.8rem", padding: "0.55rem 1.2rem" }}>
          {busy ? "กำลังส่ง…" : "ลงทะเบียน"}
        </button>
      </div>
      {result && (
        <p style={{ marginTop: "0.8rem", color: result.ok ? "#070" : "#b00" }}>
          {result.message}
          {result.link && (<><br /><a href={result.link}>กดลิงก์เข้าสู่ระบบของคุณ →</a></>)}
        </p>
      )}
      <div style={{ border: "1px dashed #bbb", borderRadius: 8, padding: "1rem", marginTop: "1.2rem" }}>
        <h2 style={{ fontSize: "1.05rem", margin: 0 }}>AI ช่วยแยกข้อมูล (ไม่บันทึก ไม่แต่ง)</h2>
        <textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={3} style={{ width: "100%", marginTop: "0.5rem" }}
          placeholder="เช่น: ขาย หินคลุก คิวละ 380 บาท อยู่บ่อใกล้อำเภอเมือง มีจำนวน 500 คิว" />
        <button type="button" onClick={askAi} style={{ marginTop: "0.4rem", padding: "0.45rem 1rem" }}>ให้ AI แยกข้อมูลให้</button>
        {aiOut && <pre style={{ whiteSpace: "pre-wrap", background: "#f6f6f6", padding: "0.6rem", marginTop: "0.5rem", fontSize: "0.85rem" }}>{aiOut}</pre>}
      </div>
      <p style={{ marginTop: "1rem" }}><a href="/pub">← กลับหน้าค้นหาทะเบียน</a></p>
    </main>
  );
}
