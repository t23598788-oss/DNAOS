/**
 * UI Inspection Capability Declaration (owner, 2026-08-06, Software
 * Factory Step 6). The DNA OS-wide, honest capability record for
 * UI_INSPECTION — status is computed live from the REAL Inspection Type
 * Registry (never hand-typed "IMPLEMENTED"), so a future NOT_IMPLEMENTED
 * type flipping to IMPLEMENTED (or vice versa) is reflected automatically,
 * never silently stale.
 *
 * factoryOwner is "qa-factory" — a REAL, already-declared Factory in
 * registry/factory-registry.json (Quality Assurance). Checked first per
 * Rule 101/103: no new Factory was invented — QA is the correct existing
 * owner for a browser-based quality inspection capability.
 */
import { listInspectionTypes } from "./inspectionRegistry";
import { listArtifactTypes } from "./artifactRegistry";
import { listViewportProfiles } from "./viewportRegistry";

export type CapabilityMaturity = "EXPERIMENTAL" | "PARTIAL" | "STABLE";

export interface CapabilityDeclaration {
  id: string;
  name: string;
  description: string;
  factoryOwner: string;
  domain: string;
  status: "NOT_IMPLEMENTED" | "PARTIAL" | "IMPLEMENTED";
  maturity: CapabilityMaturity;
  inputs: string[];
  outputs: string[];
  dependencies: string[];
  producers: string[];
  consumers: string[];
  interfaces: string[];
  inspectionTypes: { id: string; status: string }[];
  artifactTypes: string[];
  evidenceSources: string[];
  supportedPlatforms: string[];
  limitations: string[];
  health: { implementedInspectionTypes: number; totalInspectionTypes: number; percentImplemented: number };
  version: string;
}

const UI_INSPECTION_TYPE_IDS = [
  "UI_DOM_STRUCTURE_CHECK", "UI_LAYOUT_CHECK", "UI_OVERFLOW_CHECK", "UI_OVERLAP_CHECK",
  "UI_RESPONSIVE_CHECK", "UI_TEXT_RENDER_CHECK", "UI_COLOR_CONTRAST_CHECK",
  "UI_INTERACTIVE_TARGET_CHECK", "UI_LAYER_CHECK", "UI_ACCESSIBILITY_CHECK",
  "UI_PERFORMANCE_CHECK", "UI_RESOURCE_CHECK",
];

export function getUiInspectionCapability(): CapabilityDeclaration {
  const uiTypes = listInspectionTypes().filter((t) => UI_INSPECTION_TYPE_IDS.includes(t.id));
  const implemented = uiTypes.filter((t) => t.status === "IMPLEMENTED");
  const percentImplemented = uiTypes.length > 0 ? Math.round((implemented.length / uiTypes.length) * 1000) / 10 : 0;
  const status: CapabilityDeclaration["status"] = implemented.length === 0 ? "NOT_IMPLEMENTED" : implemented.length === uiTypes.length ? "IMPLEMENTED" : "PARTIAL";
  const uiArtifactTypeIds = listArtifactTypes().filter((a) => a.artifactType.startsWith("UI_")).map((a) => a.artifactType);

  const limitations: string[] = [];
  for (const t of uiTypes) {
    if (t.status === "NOT_IMPLEMENTED") limitations.push(`${t.id}: ${t.description}`);
  }
  limitations.push("Source Mapping is INFERRED (data-testid/data-component attributes) or UNKNOWN only — no real source map integration is wired this phase, so EXACT is never claimed.");
  limitations.push("Overlap detection is bounded to visible interactive + heading/paragraph elements (never true all-pairs across the whole DOM) for real performance reasons.");
  limitations.push("Color Contrast reports UNKNOWN (never a guessed PASS) whenever the real effective background is an image/gradient that can't be resolved to one solid RGB value.");

  return {
    id: "UI_INSPECTION",
    name: "UI Inspection Capability",
    description: "ความสามารถกลางสำหรับตรวจคุณภาพโครงสร้าง Web Application และ UI จาก Browser Runtime โดยใช้ข้อมูลเชิงโครงสร้างและตัวเลขจริง ไม่ใช้ AI เป็นผู้ตัดสิน",
    factoryOwner: "qa-factory",
    domain: "Quality Assurance / Browser Design Intelligence",
    status,
    maturity: status === "IMPLEMENTED" ? "STABLE" : status === "PARTIAL" ? "PARTIAL" : "EXPERIMENTAL",
    inputs: ["Target Contract (targetType/route/url/viewportProfileIds)", "real DOM", "real CSSOM", "real computed style", "real layout/box model", "real accessibility tree", "real network resource events", "real screenshot"],
    outputs: ["real Inspection Records (Step 4 pipeline)", "real UI_* Artifacts (Step 5 pipeline)", "real Findings with uiMetadata", "real annotated screenshot"],
    dependencies: ["Production Queue (Step 3)", "Execution Runtime (Step 2, reused for future CDP work)", "Inspection Pipeline (Step 4)", "Governance Runtime (Step 4.5)", "Artifact Pipeline & Evidence Warehouse (Step 5)", "Playwright (approved dependency, real Chromium)"],
    producers: ["app/api/admin/ide/_lib/browserInspectionRuntime.ts"],
    consumers: ["Problems Panel", "UI Inspection tab", "Artifacts tab"],
    interfaces: ["POST /api/admin/ide/ui-inspection/run", "GET /api/admin/ide/ui-inspection/list", "GET /api/admin/ide/ui-inspection/[inspectionId]", "GET .../findings", "GET .../artifacts", "GET .../viewports", "GET .../snapshot/[artifactId]", "POST .../cancel", "POST .../rerun"],
    inspectionTypes: uiTypes.map((t) => ({ id: t.id, status: t.status })),
    artifactTypes: uiArtifactTypeIds,
    evidenceSources: ["Playwright real Chromium (DOM/CSSOM/layout via page.evaluate)", "Chromium real CDP Accessibility.getFullAXTree", "Playwright real network response/requestfailed events", "Playwright real page.screenshot()"],
    supportedPlatforms: listViewportProfiles().map((v) => v.id),
    limitations,
    health: { implementedInspectionTypes: implemented.length, totalInspectionTypes: uiTypes.length, percentImplemented },
    version: "1.0.0",
  };
}
