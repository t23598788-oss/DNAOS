/**
 * หน้าที่: durable Engineering completion rows (manifest, admission,
 * integration). JSONL under this folder — not a second database.
 *
 * Input: typed completion records.
 * Output: append + read helpers.
 * Dependency ที่อนุญาต: node:fs, node:path, ./types.ts.
 * สิ่งที่ห้ามแตะ: never accept worker-written rows as authority.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineeringIntegrationResult, EngineeringResultAdmission, EngineeringResultManifest } from "./types";

export const ENGINEERING_COMPLETION_REGISTRY_REL = "control/engineering-runtime/data/completions.jsonl";

function dataDir(): string {
  return join(process.cwd(), "control/engineering-runtime/data");
}

function appendJsonl(fileName: string, row: unknown): string {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, fileName);
  appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
  return path;
}

export function appendJsonlNamed(fileName: string, row: unknown): string {
  return appendJsonl(fileName, row);
}

export function readJsonlObjects<T>(fileName: string): readonly T[] {
  return readJsonlIfPresent(fileName).flatMap((line) => {
    try {
      return [JSON.parse(line) as T];
    } catch {
      return [];
    }
  });
}

export function persistManifest(manifest: EngineeringResultManifest): string {
  return appendJsonl("manifests.jsonl", manifest);
}

export function persistResultAdmission(row: EngineeringResultAdmission & { readonly command_id: string; readonly work_id: string }): string {
  return appendJsonl("result-admissions.jsonl", row);
}

export function persistIntegration(row: EngineeringIntegrationResult & { readonly command_id: string; readonly work_id: string; readonly manifest_id: string }): string {
  return appendJsonl("integrations.jsonl", row);
}

export function persistCompletionRegistry(row: Record<string, unknown>): string {
  return appendJsonl("completions.jsonl", row);
}

export function readJsonlIfPresent(fileName: string): readonly string[] {
  const path = join(dataDir(), fileName);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0);
}

export function persistVerifiedCapability(row: Record<string, unknown>): string {
  return appendJsonl(process.env.ENGINEERING_VERIFIED_CAPABILITY_LOG ?? "verified-capabilities.jsonl", row);
}

export function listVerifiedCapabilities(): readonly Record<string, unknown>[] {
  return readJsonlObjects<Record<string, unknown>>(process.env.ENGINEERING_VERIFIED_CAPABILITY_LOG ?? "verified-capabilities.jsonl");
}

export interface EngineeringPublicationPointer {
  readonly work_id: string;
  readonly command_id: string;
  readonly dna_os_commit_sha: string;
  readonly remote_sha: string;
  readonly changed_paths: readonly string[];
  readonly recorded_at: string;
  readonly github_owner?: string;
  readonly github_repository?: string;
  readonly publish_branch?: string;
  readonly connection_id?: string;
  readonly manifest_id?: string;
}

export function persistPublicationPointer(row: EngineeringPublicationPointer): string {
  return appendJsonl(process.env.ENGINEERING_PUBLICATION_POINTER_LOG ?? "publication-pointers.jsonl", row);
}

export function latestPublicationPointer(workId: string): EngineeringPublicationPointer | null {
  const rows = readJsonlObjects<EngineeringPublicationPointer>(process.env.ENGINEERING_PUBLICATION_POINTER_LOG ?? "publication-pointers.jsonl").filter((row) => row.work_id === workId);
  return rows.length > 0 ? rows[rows.length - 1]! : null;
}

export function persistGithubPublicationProof(row: object): string {
  return appendJsonl(process.env.ENGINEERING_GITHUB_PROOF_LOG ?? "github-publication-proofs.jsonl", row);
}

export function persistWorkspaceCleanup(row: Record<string, unknown>): string {
  return appendJsonl(process.env.ENGINEERING_WORKSPACE_CLEANUP_LOG ?? "workspace-cleanup.jsonl", row);
}

export function listWorkspaceCleanupRecords(): readonly Record<string, unknown>[] {
  return readJsonlObjects<Record<string, unknown>>(process.env.ENGINEERING_WORKSPACE_CLEANUP_LOG ?? "workspace-cleanup.jsonl");
}

export function listGithubPublicationProofs(): readonly Record<string, unknown>[] {
  return readJsonlObjects<Record<string, unknown>>(process.env.ENGINEERING_GITHUB_PROOF_LOG ?? "github-publication-proofs.jsonl");
}

export function latestGithubPublicationProof<T = Record<string, unknown>>(workId: string): T | null {
  const rows = listGithubPublicationProofs().filter((row) => row.work_id === workId);
  return rows.length > 0 ? rows[rows.length - 1]! as T : null;
}
