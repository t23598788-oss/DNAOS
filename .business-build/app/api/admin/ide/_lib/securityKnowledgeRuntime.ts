/**
 * Security Knowledge Runtime (owner, 2026-08-08, Software Factory Step
 * 13.25, Section 6). READ ONLY by construction — this file exports no
 * execute/run/invoke function of any kind, on purpose. Knowledge and
 * Execution are two separate real files (this one, and
 * securityExecutionRuntime.ts) with zero shared mutation surface — the
 * Knowledge Runtime cannot Execute, and the Execution Runtime never
 * imports from this file to "learn" (Section 6: "Execution Runtime ไม่มี
 * สิทธิ์เรียนรู้เอง").
 */
import { listKnowledgeCategories, getKnowledgeCategory, type KnowledgeCategoryDefinition } from "./securityKnowledgeRegistry";

export function queryKnowledge(categoryId?: string): KnowledgeCategoryDefinition[] {
  if (!categoryId) return listKnowledgeCategories();
  const c = getKnowledgeCategory(categoryId);
  return c ? [c] : [];
}

export function __debugKnowledgeCategoryCount(): number {
  return listKnowledgeCategories().length;
}
