/**
 * หน้าที่: Section 6 proof — live-checks the corrected DigitalOcean MCP
 * repository SourcePointer (digitalocean-labs/mcp-digitalocean, not the
 * archived digitalocean/digitalocean-mcp) through the generic Current-
 * State pipeline, twice, proving MCP REPOSITORY -> detect -> current
 * capability state works end-to-end against the real, live source.
 *
 * How to run: npx tsx providers/digitalocean/run-mcp-source-check.ts
 */
import { resolveCurrentState } from "../_shared/source-registry/current-state";
import { DIGITALOCEAN_SOURCE_POINTERS } from "./sources/source-map";

const mcpSource = DIGITALOCEAN_SOURCE_POINTERS.find((s) => s.source_id === "digitalocean_mcp_repository")!;

async function main(): Promise<void> {
  const first = await resolveCurrentState(mcpSource);
  console.log(JSON.stringify({ pass: 1, source_id: first.source_id, status: first.status, change_type: first.change_type, fingerprint: first.fingerprint, bytes: first.normalized_value?.length ?? null }));
  const second = await resolveCurrentState(mcpSource);
  console.log(JSON.stringify({ pass: 2, source_id: second.source_id, status: second.status, change_type: second.change_type, fingerprint: second.fingerprint, bytes: second.normalized_value?.length ?? null }));
}
void main();
