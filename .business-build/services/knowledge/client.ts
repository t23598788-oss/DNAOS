/**
 * Knowledge Model client — the first real Runtime Mapping consumer
 * (registry/KNOWLEDGE_RUNTIME_MAPPING.md). Lives in services/ (I/O boundary
 * layer, per CLAUDE.md's layer stack), not core/, since core is not allowed
 * to talk to the database directly.
 *
 * Every write here is best-effort and NEVER throws to the caller — the
 * `knowledge` Postgres schema (supabase/migrations/20260717000004_
 * knowledge_schema.sql) has not been applied to production yet. A caller
 * like scripts/deploy-gate.ts must keep gating deploys correctly whether
 * or not this write succeeds; recording knowledge is a side effect, not a
 * dependency of the caller's own job.
 */
import { supabaseAdmin } from "@/services/supabase/queries";

export type KnowledgeEntryType =
  | "observation" | "incident" | "architecture_decision" | "engineering_journal"
  | "lesson" | "experience" | "rule" | "pattern" | "commit" | "deployment" | "validation";

export type KnowledgeSource =
  "owner_decision" | "ai_analysis" | "incident" | "production" | "external_document" | "experiment";

export type KnowledgeConfidence = "verified" | "observed" | "hypothesis" | "experimental";

export type KnowledgeDomain =
  "architecture" | "business" | "ai" | "runtime" | "infrastructure" | "communication" | "security" | "finance";

export interface RecordKnowledgeEntryInput {
  code: string;
  entry_type: KnowledgeEntryType;
  title: string;
  summary: string;
  detail?: string;
  source: KnowledgeSource;
  confidence?: KnowledgeConfidence;
  domains: KnowledgeDomain[];
  runtime_actionable: boolean;
  ai_actionable: boolean;
  human_actionable: boolean;
  created_by: string;
  metadata?: Record<string, unknown>;
}

export interface RecordKnowledgeEntryResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function recordKnowledgeEntry(input: RecordKnowledgeEntryInput): Promise<RecordKnowledgeEntryResult> {
  try {
    const { data, error } = await supabaseAdmin()
      .schema("knowledge")
      .from("entries")
      .insert({
        code: input.code,
        entry_type: input.entry_type,
        title: input.title,
        summary: input.summary,
        detail: input.detail ?? null,
        source: input.source,
        confidence: input.confidence ?? "observed",
        domains: input.domains,
        runtime_actionable: input.runtime_actionable,
        ai_actionable: input.ai_actionable,
        human_actionable: input.human_actionable,
        created_by: input.created_by,
        metadata: input.metadata ?? {},
      })
      .select("id")
      .single();

    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data.id };
  } catch (e) {
    // Deliberately swallowed — see file header. The `knowledge` schema not
    // existing yet is an EXPECTED failure mode today, not a bug to surface.
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function recordKnowledgeLink(
  fromEntryId: string,
  toEntryId: string,
  linkType: "evolved_from" | "superseded_by" | "caused_by" | "resolved_by" | "implements" | "references" | "derived_from" | "contradicts",
): Promise<RecordKnowledgeEntryResult> {
  try {
    const { data, error } = await supabaseAdmin()
      .schema("knowledge")
      .from("links")
      .insert({ from_entry_id: fromEntryId, to_entry_id: toEntryId, link_type: linkType })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
