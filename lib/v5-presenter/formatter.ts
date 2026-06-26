import type { EnrichedRecord } from "./enricher";

export interface FormattedResult {
  title: string;
  summary: string;
  items: FormattedItem[];
  count: number;
}

export interface FormattedItem {
  name: string;
  details: string[];
  actions?: { label: string; command: string }[];
}

export function formatPitResults(records: EnrichedRecord[], keyword: string): FormattedResult {
  return {
    title: `${keyword} (${records.length} แห่ง)`,
    summary: records.length > 0
      ? `พบ ${records.length} แห่ง${records[0].distance_km ? " เรียงจากใกล้สุด" : ""}`
      : `ไม่พบ "${keyword}"`,
    count: records.length,
    items: records.map((r, i) => ({
      name: `${i + 1}. ${r.name}`,
      details: [
        r.address && r.address !== "-" ? `ที่อยู่: ${r.address}` : "",
        r.distance_km ? `ระยะทาง: ${r.distance_km} กม.` : "",
        r.materials?.length ? `วัสดุ: ${r.materials.join(", ")}` : "",
        r.prices ? `ราคา: ${Object.entries(r.prices).map(([k, v]) => `${k} ${v} บาท/คิว`).join(", ")}` : "",
        r.lat && r.lng ? `พิกัด: ${r.lat}, ${r.lng}` : "",
      ].filter(Boolean),
      actions: [
        r.lat && r.lng ? { label: "เปิดแผนที่", command: `maps://?ll=${r.lat},${r.lng}` } : undefined,
        r.phone ? { label: `โทร ${r.phone}`, command: `tel:${r.phone}` } : undefined,
      ].filter(Boolean) as FormattedItem["actions"],
    })),
  };
}

export function formatPartnerResults(records: EnrichedRecord[], keyword: string): FormattedResult {
  return {
    title: `คู่ค้า "${keyword}" (${records.length} ราย)`,
    summary: `พบ ${records.length} ราย`,
    count: records.length,
    items: records.map((r, i) => ({
      name: `${i + 1}. ${r.name}`,
      details: [
        r.type && r.type !== "-" ? `ประเภท: ${r.type}` : "",
        r.phone && r.phone !== "-" ? `โทร: ${r.phone}` : "",
        r.address && r.address !== "-" ? `ที่อยู่: ${r.address}` : "",
      ].filter(Boolean),
      actions: r.phone && r.phone !== "-"
        ? [{ label: `โทร ${r.phone}`, command: `tel:${r.phone}` }]
        : [],
    })),
  };
}

export function formatDebtResults(records: Record<string, unknown>[], keyword: string): FormattedResult {
  return {
    title: `ลูกหนี้ "${keyword}" (${records.length} ราย)`,
    summary: `พบ ${records.length} ราย`,
    count: records.length,
    items: records.map((r, i) => ({
      name: `${i + 1}. ${r.customer_name ?? r.party_name ?? "-"}`,
      details: [
        r.principal_amount ? `เงินต้น: ${Number(r.principal_amount).toLocaleString()} บาท` : "",
        r.outstanding_amount ? `ค้างชำระ: ${Number(r.outstanding_amount).toLocaleString()} บาท` : "",
        r.invoice_status ? `สถานะ: ${r.invoice_status}` : "",
      ].filter(Boolean),
    })),
  };
}
