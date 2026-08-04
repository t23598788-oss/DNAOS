/**
 * Compares the auto-discovered graph (registry/auto-dependency-graph.json)
 * against the hand-maintained seed (registry/infra-dependency-graph.json)
 * and reports real coverage against registry/module-registry.json's known
 * resource list. Never deletes the seed — that stays until the owner
 * verifies the auto results, per explicit instruction 2026-08-04.
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { DependencyEdge, DependencyGraphDiff } from "@/core/shared/types";
import { ROOT } from "./common";

function edgeKey(e: { source: string; target: string }): string {
  // Compare by source/target only — auto and seed graphs use different id
  // prefixes in places (e.g. seed's "docker:ollama/ollama:latest (RunPod pod
  // dna-os-ollama)" vs a shorter auto id), so exact key match will
  // under-report overlap; this is an honest limitation of the diff, not
  // hidden — see roadmap #46's note in the generated report.
  return `${e.source}=>${e.target}`;
}

export function diffAgainstSeed(): DependencyGraphDiff {
  const autoPath = join(ROOT, "registry/auto-dependency-graph.json");
  const seedPath = join(ROOT, "registry/infra-dependency-graph.json");

  const auto: { edges: DependencyEdge[] } = existsSync(autoPath) ? JSON.parse(readFileSync(autoPath, "utf-8")) : { edges: [] };
  const seed: { edges: DependencyEdge[] } = existsSync(seedPath) ? JSON.parse(readFileSync(seedPath, "utf-8")) : { edges: [] };

  const autoKeys = new Set(auto.edges.map(edgeKey));
  const seedKeys = new Set(seed.edges.map(edgeKey));

  const matched = seed.edges.filter((e) => autoKeys.has(edgeKey(e))).length;
  const seedOnly = seed.edges.filter((e) => !autoKeys.has(edgeKey(e)));
  const autoOnly = auto.edges.filter((e) => !seedKeys.has(edgeKey(e)));

  const moduleRegistry = JSON.parse(readFileSync(join(ROOT, "registry/module-registry.json"), "utf-8")) as { modules: Record<string, unknown> };
  const knownResources = Object.keys(moduleRegistry.modules);
  const resourcesWithEdges = knownResources.filter((r) =>
    auto.edges.some((e) => e.source.includes(r) || e.target.includes(r))
  );

  return {
    matched,
    seed_only: seedOnly,
    auto_only: autoOnly,
    coverage: {
      known_resources: knownResources.length,
      resources_with_edges: resourcesWithEdges.length,
      coverage_ratio: knownResources.length > 0 ? resourcesWithEdges.length / knownResources.length : 0,
    },
  };
}
