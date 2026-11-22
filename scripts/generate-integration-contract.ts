import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADAPTERS } from "../engines/integration-gateway/selfDescription";

const root = process.cwd();
const docPath = resolve(root, "docs/INTEGRATION_CONTRACT.md");
const providers = JSON.parse(readFileSync(resolve(root, "registry/PROVIDER_DIRECTORY.json"), "utf8")) as {
  providers: { name: string; status: string; purpose: string; source: string }[];
};
const ai = JSON.parse(readFileSync(resolve(root, "registry/ai-adapter-registry.json"), "utf8")) as {
  adapters: { id: string; provider: string; enabled: boolean; capabilities: string[]; execution?: { status?: string } }[];
};

const rows: string[] = [
  "| Provider / adapter | Declared inbound | Declared outbound | Current source status | Evidence source |",
  "|---|---|---|---|---|",
];

for (const adapter of ADAPTERS) {
  const state = adapter.provider === "kodchat"
    ? "Bot API v1 profile verified; Connector Test and Owner Enable remain required"
    : "adapter declared in source; runtime still follows its connector and deployment gates";
  const outbound = adapter.provider === "kodchat"
    ? "POST /messages text send (connector-gated)"
    : "not declared by this observe adapter";
  rows.push(`| ${adapter.provider} | ${adapter.observes.join(", ")} | ${outbound} | ${state} | \`engines/integration-gateway/selfDescription.ts\` |`);
}

const google = providers.providers.find((entry) => entry.name === "google");
if (google) {
  rows.push(`| Google | OAuth/provider callbacks and service-specific inputs; not a chat webhook adapter | No Kod Chat-style message sender declared | ${google.status} — ${google.purpose} | \`registry/PROVIDER_DIRECTORY.json\` |`);
}

for (const adapter of ai.adapters) {
  rows.push(`| AI:${adapter.id} (${adapter.provider}) | AI Gateway request contract | AI Gateway response contract | ${adapter.enabled ? adapter.execution?.status ?? "declared" : "disabled"}; capabilities: ${adapter.capabilities.join(", ")} | \`registry/ai-adapter-registry.json\` |`);
}

const start = "<!-- GENERATED:INTEGRATION_INVENTORY:START -->";
const end = "<!-- GENERATED:INTEGRATION_INVENTORY:END -->";
const existing = readFileSync(docPath, "utf8");
const startIndex = existing.indexOf(start);
const endIndex = existing.indexOf(end);
if (startIndex < 0 || endIndex < startIndex) throw new Error("INTEGRATION_CONTRACT_GENERATED_MARKERS_MISSING");
const replacement = `${start}\n\n${rows.join("\n")}\n\n${end}`;
writeFileSync(docPath, `${existing.slice(0, startIndex)}${replacement}${existing.slice(endIndex + end.length)}`);
console.log(`Updated ${docPath} from gateway + provider + AI registries.`);
