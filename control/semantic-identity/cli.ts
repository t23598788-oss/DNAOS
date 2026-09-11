#!/usr/bin/env -S npx tsx
/**
 * Read-only semantic CLI.
 * Usage:
 *   npx tsx control/semantic-identity/cli.ts resolve <semantic-id>
 *   npx tsx control/semantic-identity/cli.ts relations <semantic-id>
 *   npx tsx control/semantic-identity/cli.ts dependencies <semantic-id>
 *   npx tsx control/semantic-identity/cli.ts impact <semantic-id>
 *   npx tsx control/semantic-identity/cli.ts source <semantic-id>
 *   npx tsx control/semantic-identity/cli.ts status <semantic-id>
 *   npx tsx control/semantic-identity/cli.ts doctor
 */

import { discoverSemanticGraph } from "./discover";
import { projectResolveThai } from "./project-th";
import { doctorSemanticGraph, resolveSemanticId } from "./resolve";

const [, , cmd, idArg] = process.argv;

const COMMANDS = new Set([
  "resolve",
  "relations",
  "dependencies",
  "impact",
  "source",
  "status",
  "doctor",
]);

if (!cmd || !COMMANDS.has(cmd) || (cmd !== "doctor" && !idArg)) {
  console.error(
    "Usage: npx tsx control/semantic-identity/cli.ts <resolve|relations|dependencies|impact|source|status|doctor> [semantic-id]",
  );
  process.exit(2);
}

const graph = discoverSemanticGraph();

if (cmd === "doctor") {
  const report = doctorSemanticGraph(graph);
  console.log("SEMANTIC GRAPH");
  console.log(`nodes: ${report.nodes}`);
  console.log(`edges: ${report.edges}`);
  for (const [k, v] of Object.entries(report.by_state).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`${k.toLowerCase()}: ${v}`);
  }
  console.log(`awaiting relation: ${report.awaiting_relation}`);
  console.log(`duplicate semantic IDs: ${report.duplicate_semantic_ids}`);
  console.log(`dependency cycles: ${report.dependency_cycles}`);
  console.log(`conflicting authority: ${report.conflicting_authority}`);
  if (report.source_revision) console.log(`revision: ${report.source_revision}`);
  process.exit(
    report.duplicate_semantic_ids || report.dependency_cycles || report.conflicting_authority
      ? 1
      : 0,
  );
}

const result = resolveSemanticId(graph, idArg!);

if (cmd === "resolve") {
  console.log(projectResolveThai(result));
  console.log("---");
  console.log(JSON.stringify(result, null, 2));
} else if (cmd === "relations") {
  console.log(JSON.stringify(result.relations, null, 2));
} else if (cmd === "dependencies") {
  console.log(JSON.stringify({ dependencies: result.dependencies, order: result.dependency_order }, null, 2));
} else if (cmd === "impact") {
  console.log(JSON.stringify({ impact: result.impact }, null, 2));
} else if (cmd === "source") {
  console.log(
    JSON.stringify(
      {
        id: result.id,
        implementation: result.current_implementation,
        source_revision: result.source_revision,
      },
      null,
      2,
    ),
  );
} else if (cmd === "status") {
  console.log(
    JSON.stringify(
      {
        id: result.id,
        status: result.status,
        current_state: result.current_state,
        thai: projectResolveThai(result),
      },
      null,
      2,
    ),
  );
}

process.exit(result.status === "IDENTITY_MATCHED" || cmd === "doctor" ? 0 : 1);
