/**
 * Real Model -> Workflow edges: extracts the real model tag list from
 * local-runtime/runpod-controller.mjs's own REQUIRED_MODELS constant (the
 * single real source of truth for what models this system uses — not
 * hand-typed here), then greps other real source files for each literal
 * tag to find which scripts/functions actually reference it.
 */
import { readFileSync, readdirSync } from "fs";
import { join, extname } from "path";
import type { DependencyEdge, UnknownDependency } from "@/core/shared/types";
import { ROOT, edge, unknown } from "./common";

function extractRequiredModels(): string[] {
  const src = readFileSync(join(ROOT, "local-runtime/runpod-controller.mjs"), "utf-8");
  const m = src.match(/REQUIRED_MODELS\s*=\s*\[([^\]]+)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function walkSourceFiles(dir: string, exts: string[], out: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walkSourceFiles(full, exts, out);
    else if (exts.includes(extname(e.name))) out.push(full);
  }
  return out;
}

export function scanAiModelsRuntime(): { edges: DependencyEdge[]; unknowns: UnknownDependency[] } {
  const models = extractRequiredModels();
  const edges: DependencyEdge[] = [];
  const unknowns: UnknownDependency[] = [];

  if (models.length === 0) {
    unknowns.push(unknown("runpod-controller.mjs#REQUIRED_MODELS", "ai_models_runtime", "could not extract REQUIRED_MODELS from real source — regex did not match"));
    return { edges, unknowns };
  }

  const candidateFiles = [
    ...walkSourceFiles(join(ROOT, "local-runtime"), [".mjs", ".ts"]),
    ...walkSourceFiles(join(ROOT, "supabase/functions"), [".ts"]),
  ];

  for (const model of models) {
    let foundOutsideDefinition = false;
    for (const file of candidateFiles) {
      const content = readFileSync(file, "utf-8");
      const idx = content.indexOf(`"${model}"`);
      if (idx === -1) continue;
      const line = content.slice(0, idx).split("\n").length;
      const relFile = file.replace(ROOT + "/", "");
      if (relFile.includes("runpod-controller.mjs")) continue; // that's the definition itself, not a real usage — must not count toward "found"
      foundOutsideDefinition = true;
      const e = edge(
        `model:${model}`, `module:${relFile}`, "model_used_by_workflow",
        [{ kind: "model_tag_reference", file: relFile, line, detail: `real string literal "${model}" found` }],
        0.85
      );
      if (e) edges.push(e);
    }
    if (!foundOutsideDefinition) unknowns.push(unknown(`model:${model}`, "ai_models_runtime", "declared in REQUIRED_MODELS but no real source file outside runpod-controller.mjs's own definition references this exact tag string"));
  }

  return { edges, unknowns };
}
