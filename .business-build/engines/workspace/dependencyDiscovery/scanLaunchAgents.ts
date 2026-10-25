/**
 * Real LaunchAgent -> Script edges, parsed from the actual .plist XML files
 * in local-runtime/launchagents/ — replaces the hand-typed equivalent edges
 * in registry/infra-dependency-graph.json with real parsed evidence.
 *
 * Deliberately a targeted regex extraction, not a general plist library:
 * every plist here is authored by this project in one predictable shape
 * (Label + ProgramArguments array of <string> elements). If a plist doesn't
 * match that shape, it's reported as UNKNOWN rather than guessed.
 */
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { DependencyEdge, UnknownDependency } from "@/core/shared/types";
import { ROOT, edge, unknown } from "./common";

export function scanLaunchAgents(): { edges: DependencyEdge[]; unknowns: UnknownDependency[] } {
  const dir = join(ROOT, "local-runtime/launchagents");
  const edges: DependencyEdge[] = [];
  const unknowns: UnknownDependency[] = [];

  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".plist"));
  } catch {
    return { edges, unknowns };
  }

  for (const file of files) {
    const full = join(dir, file);
    const xml = readFileSync(full, "utf-8");

    const labelMatch = xml.match(/<key>Label<\/key>\s*<string>([^<]+)<\/string>/);
    const label = labelMatch?.[1];

    const argsBlockMatch = xml.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
    if (!label || !argsBlockMatch) {
      unknowns.push(unknown(`launchagent:${file}`, "launchagents", "could not parse Label or ProgramArguments from real plist XML"));
      continue;
    }

    const stringMatches = [...argsBlockMatch[1].matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
    // The real script path is whichever argument ends in a real extension
    // (.mjs/.ts/.sh) — not just "the last string", since e.g. npx tsx <path>
    // has the path as the 3rd argument, while node <path> has it as the 2nd.
    const scriptArg = stringMatches.find((a) => /\.(mjs|ts|sh)$/.test(a));
    if (!scriptArg) {
      unknowns.push(unknown(`launchagent:${label}`, "launchagents", `parsed ProgramArguments [${stringMatches.join(", ")}] but none look like a script path`));
      continue;
    }

    const e = edge(
      `launchagent:${label}`, `script:${scriptArg}`, "launchagent_runs",
      [{ kind: "plist_program_arguments", file: `local-runtime/launchagents/${file}`, detail: `ProgramArguments = [${stringMatches.join(", ")}]` }],
      0.95
    );
    if (e) edges.push(e);
  }

  return { edges, unknowns };
}
