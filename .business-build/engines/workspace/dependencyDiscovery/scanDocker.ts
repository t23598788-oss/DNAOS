/**
 * Real Docker inspection — reuses engines/storage/adapters/dockerAdapter.ts
 * (already read-only). When the daemon isn't running, this is reported as
 * UNKNOWN, never guessed — this repo's real Docker Desktop is frequently
 * stopped (confirmed live 2026-08-04 during the storage-intelligence work).
 */
import type { DependencyEdge, UnknownDependency } from "@/core/shared/types";
import { inspectDocker } from "@/engines/storage/adapters/dockerAdapter";
import { edge, unknown } from "./common";

export function scanDocker(): { edges: DependencyEdge[]; unknowns: UnknownDependency[] } {
  const report = inspectDocker();
  if (!report.daemon_running) {
    return { edges: [], unknowns: [unknown("docker:daemon", "docker", report.note)] };
  }

  const edges: DependencyEdge[] = [];
  const unknowns: UnknownDependency[] = [];

  if (report.dangling_image_ids.length === 0 && report.unused_volume_names.length === 0) {
    unknowns.push(unknown("docker:images-and-volumes", "docker", "daemon running but no dangling images/volumes to report an edge for — not a failure, just nothing to link"));
  }
  for (const volName of report.unused_volume_names) {
    const e = edge(`docker:volume:${volName}`, `docker:daemon`, "docker_uses_volume",
      [{ kind: "docker_inspect", file: "runtime: docker volume ls -f dangling=true", detail: `volume ${volName} exists, unmounted (real docker inspect result)` }], 0.9);
    if (e) edges.push(e);
  }

  return { edges, unknowns };
}
