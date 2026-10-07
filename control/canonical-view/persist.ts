import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataPath } from "./host-runtime";

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const rows: T[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      /* skip */
    }
  }
  return rows;
}

function appendJsonl(file: string, row: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
}

export function reviewsFile(): string {
  return dataPath("reviews.jsonl", "CANONICAL_VIEW_REVIEWS_LOG");
}

export function previewsFile(): string {
  return dataPath("previews.jsonl", "CANONICAL_VIEW_PREVIEWS_LOG");
}

export function persistPreview(row: unknown): void {
  appendJsonl(previewsFile(), row);
}

export function persistReview(row: unknown): void {
  appendJsonl(reviewsFile(), row);
}

export function listPersistedPreviews<T>(): T[] {
  return readJsonl<T>(previewsFile());
}

export function listPersistedReviews<T>(): T[] {
  return readJsonl<T>(reviewsFile());
}
