/**
 * Run the publication auth probe against the GitHub connection visible
 * from process.cwd() registries. Prints one JSON line, never a secret.
 *
 * How to run:
 *   npx tsx control/engineering-runtime/tests/publication-auth-probe-run.ts
 */

import { lookupConnection, listConnections } from "../../../connections/connection-registry/contract";
import { probeGithubPublicationAuth } from "../../../connections/github/publication-auth-probe";
import { containsCredentialMaterial } from "../../../connections/dna-os-mcp/runtime-facts";

declare const process: { cwd(): string; exit(code?: number): never };
declare const console: { log(...args: unknown[]): void };

async function main(): Promise<void> {
  const connection = lookupConnection({
    adapter: "github",
    target: { owner: "t23598788-oss", repository: "-DNA-OS-INFRASTRUCTURE-", branch: "main" },
  }) ?? listConnections().find((row) =>
    row.adapter === "github"
    && row.target?.repository === "-DNA-OS-INFRASTRUCTURE-"
    && row.credential_ref.kind === "keychain_ref"
  ) ?? null;
  const probe = await probeGithubPublicationAuth(connection);
  const report = { ...probe, CREDENTIAL_SECRET_EXPOSED: containsCredentialMaterial(probe) };
  console.log(`DNA_OS_PUBLICATION_AUTH_PROBE ${JSON.stringify(report)}`);
  process.exit(probe.publication_auth_ok && !report.CREDENTIAL_SECRET_EXPOSED ? 0 : 2);
}

void main();
