/**
 * หน้าที่: แผนที่พื้นผิวที่ DNA OS เป็นเจ้าของ — บอกว่าแต่ละ route ประกอบด้วย
 * อะไร ไฟล์ไหนเป็นเจ้าของ และ "ค่าที่ถูกต้อง" ของแต่ละ route คืออะไร
 *
 * Owner, 2026-09-05 ข้อ 11: ถ้าข้อเท็จจริงหาได้จาก contract/map/source ระบบ
 * ต้องตัดสินเอง ห้ามดึง Owner มาตัดสิน ก่อนหน้านี้ผู้ตรวจถาม Owner ว่า
 * "#command ต้องมีหัวข้อกี่ตัว" ซึ่งผิด — คำตอบอยู่ในตัว source อยู่แล้ว และ
 * ที่ของมันคือแผนที่นี้ พร้อม `evidence` ที่ชี้บรรทัดที่พิสูจน์
 *
 * ทุก entry ต้องมี evidence เสมอ ค่าที่ไม่มีหลักฐานรองรับห้ามอยู่ในแผนที่ —
 * ไม่งั้นแผนที่จะกลายเป็นความเห็นที่เขียนให้ผลตรวจผ่าน
 *
 * Input: none (ประกาศล้วน)
 * Output: SURFACES, findSurface
 * Dependency ที่อนุญาต: none
 * สิ่งที่ห้ามแตะ:
 * - ห้ามเพิ่ม/แก้ค่าคาดหวังโดยไม่ใส่ evidence ที่ชี้ source จริง
 * - ห้ามให้ Agent หรือผู้ถูกตรวจแก้ไฟล์นี้เพื่อให้ตัวเองผ่าน
 */

export interface SurfaceElement {
  readonly element_id: string;
  readonly selector: string;
  readonly owner_file: string;
}

export interface SurfaceSpec {
  readonly route: string;
  readonly surface: string;
  readonly base_url: string;
  /** ไฟล์ที่เป็นเจ้าของพื้นผิวนี้ — ใช้เป็นขอบเขตที่เล็กที่สุดตอน dispatch */
  readonly owner_files: readonly string[];
  readonly elements: readonly SurfaceElement[];
  /**
   * จำนวนหัวข้อของ route ที่ต้องมองเห็นได้
   *
   * #command เป็น 0 เพราะออกแบบเป็น full-canvas: app.css:200 ซ่อน .topbar และ
   * มุมมองคำสั่งไม่ได้เรนเดอร์ h1/h2 เลย (ยืนยันด้วย DOM จริง stage_headings=[])
   * ส่วน route อื่นเป็น 1 เพราะเนื้อหามี h2 เดียวและ .view-name ถูกซ่อนแล้ว
   */
  readonly expected_visible_heading_count: number;
  readonly verification_profile: string;
  /** หลักฐานที่ทำให้ค่าข้างบนไม่ใช่ความเห็น */
  readonly evidence: readonly string[];
}

const WORKSPACE = "/Users/tam/Developer/DNA-OS/source/dna-os-control-workspace";
const BASE = "http://127.0.0.1:5181";

const SHELL_ELEMENTS: readonly SurfaceElement[] = [
  { element_id: "identity_block", selector: ".brand", owner_file: `${WORKSPACE}/app/index.html` },
  { element_id: "nav_rail", selector: ".sidebar", owner_file: `${WORKSPACE}/app/styles/app.css` },
  { element_id: "top_bar", selector: ".topbar", owner_file: `${WORKSPACE}/app/styles/app.css` },
  { element_id: "route_heading", selector: ".stage h1, .stage h2", owner_file: `${WORKSPACE}/app/main.mjs` },
];

export const SURFACES: readonly SurfaceSpec[] = [
  {
    route: "/#command", surface: "owner_command_workspace", base_url: BASE,
    owner_files: [`${WORKSPACE}/features/command/command-view.mjs`, `${WORKSPACE}/features/control-chat/chat.mjs`, `${WORKSPACE}/app/styles/app.css`],
    elements: [...SHELL_ELEMENTS, { element_id: "command_composer", selector: ".chat-form", owner_file: `${WORKSPACE}/features/control-chat/chat.mjs` }],
    expected_visible_heading_count: 0,
    verification_profile: "OWNER_SURFACE_V1",
    evidence: [
      `${WORKSPACE}/app/styles/app.css:200 -> .app[data-view="command"] .topbar{display:none}`,
      "DOM จริง 2026-09-04: stage_headings=[] chrome_headings=[] บน /#command",
    ],
  },
  {
    route: "/#services", surface: "services_view", base_url: BASE,
    owner_files: [`${WORKSPACE}/features/views.mjs`, `${WORKSPACE}/app/styles/app.css`],
    elements: SHELL_ELEMENTS, expected_visible_heading_count: 1,
    verification_profile: "OWNER_SURFACE_V1",
    evidence: [`DOM จริง 2026-09-04: stage_headings=["บริการ"] chrome_headings=[] บน /#services`],
  },
  {
    route: "/#system", surface: "system_view", base_url: BASE,
    owner_files: [`${WORKSPACE}/features/views.mjs`, `${WORKSPACE}/app/styles/app.css`],
    elements: SHELL_ELEMENTS, expected_visible_heading_count: 1,
    verification_profile: "OWNER_SURFACE_V1",
    evidence: [`DOM จริง 2026-09-04: stage_headings=["ระบบ"] บน /#system`],
  },
  {
    route: "/#settings", surface: "settings_view", base_url: BASE,
    owner_files: [`${WORKSPACE}/features/views.mjs`, `${WORKSPACE}/app/styles/app.css`],
    elements: SHELL_ELEMENTS, expected_visible_heading_count: 1,
    verification_profile: "OWNER_SURFACE_V1",
    evidence: [`DOM จริง 2026-09-04: stage_headings=["ตั้งค่า"] บน /#settings`],
  },
];

export function findSurface(route: string): SurfaceSpec | null {
  return SURFACES.find((s) => s.route === route) ?? null;
}

/** หา surface จาก element ที่ Owner พูดถึง — คืนทุก route ที่มี element นั้น */
export function surfacesWithElement(elementId: string): readonly SurfaceSpec[] {
  return SURFACES.filter((s) => s.elements.some((e) => e.element_id === elementId));
}
