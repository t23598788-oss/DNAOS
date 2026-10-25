/**
 * Real TS import graph — reuses registry/architecture-book.json (generated
 * by scripts/build-arch-book.ts from actual import statements, 621
 * nodes/1973 edges as of 2026-08-04). Per Rule 101/103, this does not
 * re-derive the graph — it wraps the existing real output with evidence.
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { DependencyEdge } from "@/core/shared/types";
import { ROOT } from "./common";

export function scanTypescriptImports(): DependencyEdge[] {
  const archBook = JSON.parse(readFileSync(join(ROOT, "registry/architecture-book.json"), "utf-8")) as {
    generated_at: string;
    edges: { source: string; target: string; label: string }[];
  };
  return archBook.edges
    .filter((e) => e.label === "imports")
    .map((e) => ({
      source: e.source,
      target: e.target,
      kind: "imports" as const,
      source_generated: "auto-discovery" as const,
      confidence: 1.0,
      evidence: [{
        kind: "typescript_import" as const,
        file: "registry/architecture-book.json",
        detail: `real import statement, graph generated ${archBook.generated_at}`,
      }],
    }));
}
