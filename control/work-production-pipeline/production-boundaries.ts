/**
 * Normalized production-gap boundaries for DNA_OS_WORK_PRODUCTION_PIPELINE_V1.
 * Reads existing machine connection documents — not prose markdown.
 */

import { loadConnectionSummaries, queryConnectionBoundary, type ConnectionStatusEnum } from "../conversation-runtime/connection-summary";

export const PRODUCTION_BOUNDARY_PROJECTION = "PRODUCTION_BOUNDARY_PROJECTION_V1" as const;

export function productionBoundaryProjection(): {
  readonly schema: typeof PRODUCTION_BOUNDARY_PROJECTION;
  readonly GITHUB_PUBLISH_TO_DEPLOYMENT_AUTHORITY: ConnectionStatusEnum | "NOT_FOUND";
  readonly RAILWAY_DEPLOYMENT_MUTATION: ConnectionStatusEnum | "NOT_FOUND";
  readonly RAILWAY_OWNER_ROUTER_CAPABILITY: ConnectionStatusEnum | "NOT_FOUND";
  readonly evidence_refs: readonly string[];
} {
  const { summaries } = loadConnectionSummaries();
  const github = queryConnectionBoundary(summaries, "GITHUB_PUBLISH", "DEPLOYMENT_AUTHORITY");
  let railwayMutation: ConnectionStatusEnum | "NOT_FOUND" = "NOT_FOUND";
  let railwayRouter: ConnectionStatusEnum | "NOT_FOUND" = "NOT_FOUND";
  const railway = summaries.find((row) => row.connection_id.includes("railway"));
  if (railway) {
    const mut = railway.not_wired_boundaries.find((label) => /deployment\/write\/mutation/i.test(label) || /Railway deployment\/write\/mutation/i.test(label));
    railwayMutation = mut ? "NOT_WIRED" : queryConnectionBoundary(summaries, "Railway provider connector", "Railway deployment/write/mutation APIs");
    const router = railway.not_wired_boundaries.find((label) => /Owner command-router capability entry → Railway/i.test(label));
    railwayRouter = router ? "NOT_WIRED" : "NOT_FOUND";
  }
  return {
    schema: PRODUCTION_BOUNDARY_PROJECTION,
    GITHUB_PUBLISH_TO_DEPLOYMENT_AUTHORITY: github === "NOT_FOUND" ? "NOT_WIRED" : github,
    RAILWAY_DEPLOYMENT_MUTATION: railwayMutation === "NOT_FOUND" ? "NOT_WIRED" : railwayMutation,
    RAILWAY_OWNER_ROUTER_CAPABILITY: railwayRouter === "NOT_FOUND" ? "NOT_WIRED" : railwayRouter,
    evidence_refs: summaries.filter((row) => row.connection_id.includes("engineering-runtime") || row.connection_id.includes("railway")).map((row) => row.evidence_ref),
  };
}

export function githubPublishToDeploymentAuthority(): ConnectionStatusEnum | "NOT_FOUND" {
  return productionBoundaryProjection().GITHUB_PUBLISH_TO_DEPLOYMENT_AUTHORITY;
}
