/**
 * PUBLIC WEBSITE (/pub) — owner directive 2026-10-15 (PHASE 6 discovery)
 *
 * หน้าสาธารณะเดียวของทะเบียนทรัพยากรกลาง:
 *   · ไม่ต้อง login — /pub ไม่อยู่ใน PROTECTED_PAGE_PREFIXESของ middleware (เดิม)
 *   · ข้อมูลจากตารางเดิมเท่านั้น — เฉพาะ PUBLIC fields (ชื่อ/ที่อยู่/พิกัด/วัสดุ+ราคาจริง)
 *     ไม่มีข้อมูล PRIVATE (เจ้าของ/tax_id/บัญชีธนาคาร) หลุดออก
 *   · ไม่ประกาศ VERIFIED — แสดงแหล่งหลักฐานเสมอ (pit_materials จริง)
 *   · ไฟล์ใหม่แยก path —ไม่แตะหน้าเดิมของระบบ
 */
import type { Metadata } from "next";
import { listPublicRegistry } from "@/engines/public-registry/service";
import { publicJsonLd } from "./publicReference";

export const dynamic = "force-dynamic";

// PUBLIC DISCOVERY (owner 2026-10-20): page-specific title, description and canonical URL.
export const metadata: Metadata = {
  title: "ทะเบียนทรัพยากรภูมิภาคกลาง — DNA OS",
  description: "ค้นหาแหล่งทรัพยากรและวัสดุที่ลงทะเบียนกับ DNA OS พร้อมราคาที่ผู้ลงทะเบียนระบุ",
  alternates: { canonical: "https://dnaos.dev/pub" },
};

export default async function PublicRegistryPage({ searchParams }: { searchParams: Promise<{ keyword?: string }> }) {
  const { keyword } = await searchParams;
  const result = await listPublicRegistry(keyword ?? undefined);

  // JSON-LD from the single public reference source; "<" escaped so the payload cannot close the script tag.
  const jsonLd = JSON.stringify(publicJsonLd()).replace(/</g, "\\u003c");

  return (
    <main style={{ maxWidth: 760, margin: "2rem auto", padding: "0 1rem", fontFamily: "system-ui, sans-serif" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <h1 style={{ fontSize: "1.6rem" }}>ทะเบียนทรัพยากรภูมิภาคกลาง (DNA OS)</h1>
      <p style={{ color: "#555" }}>แหล่งทรัพยากร/ผู้ประกอบการที่ลงทะเบียนเองต่อระบบ — แสดงเฉพาะข้อมูลสาธารณะ ราคามาจากหลักฐานจริงของผู้ลงทะเบียนเสมอ</p>
      <form method="get" style={{ marginBottom: "1rem" }}>
        <input name="keyword" placeholder="ค้นหาชื่อโกดัง/บ่อ/แหล่งผลิต" defaultValue={keyword ?? ""} style={{ padding: "0.5rem", width: "60%" }} />
        <button type="submit" style={{ padding: "0.5rem 1rem", marginLeft: "0.5rem" }}>ค้นหา</button>
        <a href="/pub/register" style={{ marginLeft: "1rem" }}>ลงทะเบียนทรัพยากรของคุณ →</a>
      </form>
      {!result.ok && <p style={{ color: "#b00" }}>ไม่สามารถอ่านทะเบียนได้ตอนนี้: {result.error}</p>}
      {result.ok && result.total === 0 && <p>ยังไม่มีรายการที่ตรงกับการค้นหา (NOT_FOUND — ระบบไม่เดาแทน)</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {(result.entries ?? []).map((e, i) => {
          const entry = e as {
            site_name?: string; address?: string | null; grid?: { latitude?: number; longitude?: number };
            available_materials?: { material: string; price: number | null }[];
          };
          return (
            <li key={i} style={{ border: "1px solid #ddd", borderRadius: 8, padding: "0.75rem", marginBottom: "0.6rem" }}>
              <strong>{entry.site_name ?? "(ไม่มีชื่อ)"}</strong>
              {entry.address ? <div style={{ fontSize: "0.9rem", color: "#555" }}>{entry.address}</div> : null}
              {entry.grid?.latitude ? <div style={{ fontSize: "0.85rem", color: "#888" }}>พิกัด: {entry.grid.latitude}, {entry.grid.longitude}</div> : null}
              <div style={{ marginTop: "0.4rem" }}>
                {(entry.available_materials ?? []).length === 0 ? (
                  <em style={{ color: "#888" }}>ยังไม่มีวัสดุลงทะเบียนราคา</em>
                ) : (
                  entry.available_materials!.map((m, j) => (
                    <div key={j} style={{ fontSize: "0.9rem" }}>
                      • {m.material}: {m.price != null ? `${m.price} บาท (หลักฐาน: ผู้ลงทะเบียน)` : "(ยังไม่ระบุราคา)"}
                    </div>
                  ))
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
