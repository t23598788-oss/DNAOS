/**
 * หน้าที่: แปลง "เจตนาที่ resolve แล้ว" เป็น "ความสามารถที่ต้องใช้" แบบกำหนดผลได้
 *
 * Owner, 2026-09-05: Owner พูดภาษาคน ไม่ต้องพูดชื่อ tool ระบบจึงต้องรู้เองว่า
 * คำสั่งนี้ต้องใช้ความสามารถอะไร ตารางนี้เป็นของ DNA OS ไม่ใช่ของโมเดล และไม่ใช่
 * ของ Agent การจับคู่เป็นการเทียบคำตรง ๆ ไม่มีการอนุมานความหมาย
 *
 * ทำไมไม่ใช้โมเดลแปลเจตนา: โมเดลเป็นทรัพยากรหนึ่ง ไม่ใช่ผู้มีอำนาจ ถ้าโมเดล
 * เป็นคนบอกว่า "ต้องใช้ Gmail" ระบบก็กลับไปเชื่อข้อความของ Agent อีก ที่นี่จึง
 * เป็นตารางที่อ่านได้ ตรวจได้ และเปลี่ยนได้เฉพาะโดยผู้ที่แก้ source นี้
 *
 * ความสามารถที่ตารางไม่รู้จัก = ไม่รู้ ไม่ใช่ไม่ต้องใช้ — คืน UNRESOLVED
 *
 * Input: ข้อความคำสั่งที่ผ่านการ resolve แล้ว
 * Output: IntentCapabilityResolution
 * Dependency ที่อนุญาต: none
 * สิ่งที่ห้ามแตะ:
 * - ห้ามให้ผู้เรียกส่งรายการความสามารถเข้ามาเอง
 * - ห้ามเดาความสามารถจากคำที่ไม่อยู่ในตาราง
 */

export interface CapabilityMarker {
  readonly capability: string;
  /** คำที่ปรากฏในคำสั่งแล้วถือว่าต้องใช้ความสามารถนี้ — เทียบตรง ไม่ตีความ */
  readonly markers: readonly string[];
  readonly read_write_class: "READ_ONLY" | "EXTERNAL_WRITE";
}

export const CAPABILITY_MARKERS: readonly CapabilityMarker[] = [
  { capability: "calendar.list_events", read_write_class: "READ_ONLY",
    markers: ["งานวันนี้", "ตารางงาน", "นัด", "ปฏิทิน", "ตารางวันนี้", "ประชุม"] },
  { capability: "email.list_labels", read_write_class: "READ_ONLY",
    markers: ["เมลที่ยังไม่อ่าน", "เมลค้าง", "จำนวนเมล", "อีเมลที่ยังไม่อ่าน", "กล่องจดหมาย"] },
  { capability: "email.search_threads", read_write_class: "READ_ONLY",
    markers: ["ค้นเมล", "หาเมล", "เมลจาก", "อีเมลเรื่อง"] },
];

export interface IntentCapabilityResolution {
  readonly status: "RESOLVED" | "UNRESOLVED";
  readonly required_capabilities: readonly string[];
  readonly matched_markers: readonly { capability: string; marker: string }[];
  readonly read_write_classes: readonly string[];
  readonly reason: string;
}

export function requiredCapabilitiesFor(commandText: string): IntentCapabilityResolution {
  const matched: { capability: string; marker: string }[] = [];
  for (const entry of CAPABILITY_MARKERS) {
    const hit = entry.markers.find((m) => commandText.includes(m));
    if (hit !== undefined) matched.push({ capability: entry.capability, marker: hit });
  }
  if (matched.length === 0) {
    return { status: "UNRESOLVED", required_capabilities: [], matched_markers: [], read_write_classes: [],
      reason: "ไม่มีคำใดในคำสั่งตรงกับตารางความสามารถ — ไม่ทราบว่าต้องใช้อะไร จึงไม่ค้นทรัพยากรและไม่เรียกอะไรเลย" };
  }
  const caps = [...new Set(matched.map((m) => m.capability))];
  const classes = [...new Set(caps.map((c) => CAPABILITY_MARKERS.find((e) => e.capability === c)!.read_write_class))];
  return { status: "RESOLVED", required_capabilities: caps, matched_markers: matched, read_write_classes: classes,
    reason: `ตรงกับ ${matched.length} คำในตาราง -> ${caps.length} ความสามารถ` };
}
