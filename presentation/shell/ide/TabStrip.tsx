"use client";

/**
 * IDE Primitives — TabStrip (EXTRACTED, source-preserving)
 *
 * ย้ายออกจาก components/ide-shell/IDEWorkspace.tsx โดยไม่แก้ behavior
 * เพื่อให้ "ONE IMPLEMENTATION · TWO CONSUMERS":
 *   - Software Factory IDE (/admin/ide)
 *   - Business Workspace (/workspace)
 *
 * รอบนี้ย้ายเฉพาะ TabStrip + ชนิดข้อมูล/ค่าสีที่มันต้องใช้ (ตามที่พิสูจน์แล้วว่า
 * ไม่มี test ใดผูกกับ "ตำแหน่งโค้ด" ของมัน) — TreeNode/SearchPanel/DiffPane/
 * ProblemsPanel ยังไม่ย้าย เพราะมี test ที่ยืนยันว่าต้องอยู่ใน IDEWorkspace.tsx
 * (scripts/github-connector-test.ts:149) ต้องให้ Owner ตัดสินก่อน
 *
 * โค้ดทุกบรรทัดคัดลอกจากต้นทางแบบคำต่อคำ (ห้ามแก้ behavior)
 */
import { X, Lock } from "lucide-react";

export type CodeCategory =
  | "CORE_LOGIC" | "AI" | "INTEGRATION" | "WORKFLOW" | "DATABASE" | "SECURITY" | "UI" | "CONFIGURATION" | "DOCUMENTATION" | "UNKNOWN";
export type RiskLevel = "NORMAL" | "SENSITIVE" | "CRITICAL" | "LOCKED" | "UNKNOWN";

export interface ClassificationInfo {
  category: CodeCategory; categoryLabel: string; capability: string | null; riskLevel: RiskLevel;
  evidence: string[]; requiredChecks: string[]; purposeTh: string | null;
}

export const CATEGORY_COLORS: Record<CodeCategory, string> = {
  CORE_LOGIC: "#A6484B",
  AI: "#3F7A54",
  INTEGRATION: "#3E6690",
  WORKFLOW: "#6B4E9E",
  DATABASE: "#A06A2E",
  SECURITY: "#8A7A2E",
  UI: "#64748B",
  CONFIGURATION: "#2F7D78",
  DOCUMENTATION: "#4C5D80",
  UNKNOWN: "#94A3B8",
};

export const RISK_COLORS: Record<RiskLevel, string> = {
  NORMAL: "#94A3B8", SENSITIVE: "#B45309", CRITICAL: "#B91C1C", LOCKED: "#0F172A", UNKNOWN: "#64748B",
};

export const RISK_LABELS_TH: Record<RiskLevel, string> = {
  NORMAL: "ปกติ", SENSITIVE: "ละเอียดอ่อน", CRITICAL: "วิกฤต", LOCKED: "ล็อก (อ่านอย่างเดียว)", UNKNOWN: "ไม่ทราบ",
};

export function classificationTooltip(c: ClassificationInfo): string {
  const lines = [`${c.categoryLabel}${c.capability ? ` / ${c.capability}` : ""} · ${RISK_LABELS_TH[c.riskLevel]}`];
  if (c.purposeTh) lines.push(c.purposeTh);
  if (c.evidence.length > 0) lines.push(...c.evidence.map((e) => `• ${e}`));
  return lines.join("\n");
}

export interface Tab {
  id: string;
  title: string;
  kind: "file" | "diff";
  path: string;
  staged?: boolean; // only meaningful for kind "diff"
}

// Per-file editor state (owner, 2026-08-05, Phase 2) — lives at page level,
// keyed by tab id, so switching tabs never loses in-progress edits.
// "dirty" is derived (content !== originalContent), never stored separately.
export interface FileTabState {
  content: string;
  originalContent: string;
  hash: string;
  modifiedAt: string;
  loading: boolean;
  error: string | null;
  conflict: { diskContent: string; diskHash: string; diskModifiedAt: string } | null;
  classification?: ClassificationInfo | null;
  encoding?: string;
  lineEnding?: "LF" | "CRLF" | "mixed";
  lastSavedAt?: string | null;
}

export function isDirty(state: FileTabState | undefined): boolean {
  return !!state && !state.loading && !state.error && state.content !== state.originalContent;
}

export function TabStrip({ tabs, activeTabId, onSelect, onClose, dirtyTabIds, fileStates }: {
  tabs: Tab[]; activeTabId: string | null; onSelect: (id: string) => void; onClose: (id: string) => void; dirtyTabIds: string[];
  fileStates: Record<string, FileTabState>;
}) {
  if (tabs.length === 0) return <div style={{ height: 35, background: "#EEF2F7", borderBottom: "1px solid #E2E8F0", flexShrink: 0 }} />;
  const dirtySet = new Set(dirtyTabIds);
  return (
    <div style={{ display: "flex", background: "#EEF2F7", borderBottom: "1px solid #E2E8F0", overflowX: "auto", overflowY: "hidden", flexShrink: 0 }}>
      {tabs.map((t) => {
        const dirty = dirtySet.has(t.id);
        const classification = fileStates[t.id]?.classification;
        const categoryColor = classification ? CATEGORY_COLORS[classification.category] : null;
        return (
          <div
            key={t.id}
            onClick={() => onSelect(t.id)}
            title={classification ? classificationTooltip(classification) : (dirty ? `${t.title} — unsaved changes` : t.title)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", fontSize: 12.5, cursor: "pointer",
              background: activeTabId === t.id ? "#FFFFFF" : "transparent", borderRight: "1px solid #E2E8F0",
              borderTop: categoryColor ? `2px solid ${categoryColor}` : "2px solid transparent",
              color: activeTabId === t.id ? "#0F172A" : "#64748B", whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            {dirty && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#B45309", flexShrink: 0 }} />}
            {classification?.riskLevel === "LOCKED" && <Lock size={11} style={{ color: RISK_COLORS.LOCKED, flexShrink: 0 }} />}
            {t.title}
            <X size={12} onClick={(e) => { e.stopPropagation(); onClose(t.id); }} />
          </div>
        );
      })}
    </div>
  );
}
