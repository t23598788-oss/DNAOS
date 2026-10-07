import * as readline from "node:readline";
import { registerOwnerDatabaseCredential } from "../credentials/macos-keychain/registration";

/**
 * 2026-08-24 (Owner, "Single Process Creation Gate — Consolidation"):
 * this used to shell out to `/bin/sh -c "stty -echo/echo"` to hide
 * terminal input — a real, forbidden `sh -c` invocation. Node's own
 * `readline` interface can mute its own output stream during the
 * question without any subprocess at all — the same real technique
 * Node's own `password`-style CLI prompts use.
 */
async function askHidden(rl: readline.Interface, prompt: string): Promise<string> {
  const output = process.stdout as unknown as { write(chunk: string): boolean };
  const realWrite = output.write.bind(output);
  process.stdout.write(prompt);
  let muted = true;
  output.write = ((chunk: string) => (muted ? true : realWrite(chunk))) as typeof output.write;
  try {
    return await new Promise<string>((resolve) => rl.question("", (answer) => resolve(answer)));
  } finally {
    muted = false;
    output.write = realWrite;
    process.stdout.write("\n");
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function main(): Promise<void> {
  console.log("DNA OS owner credential registration");
  console.log("Target: 127.0.0.1:5432/postgres | Role: tam");
  const secret = await askHidden(rl, "Secret (hidden): ");
  rl.close();
  try {
    const result = await registerOwnerDatabaseCredential({
      requester_identity: "scripts/register-local-postgres-credential.ts",
      owner: "owner",
      target: { host: "127.0.0.1", port: 5432, database: "postgres", role: "tam", schema: "software_registry" },
      scope: ["database:connect", "software_registry:read", "software_registry:write"],
      service: "dna-os-postgres",
      account: "owner",
      secret,
    });
    console.log(`CREDENTIAL_REF=${result.credential_ref}`);
    console.log("KEYCHAIN_STORE=macOS Keychain");
    console.log("TARGET=127.0.0.1:5432/postgres");
    console.log("ROLE=tam");
    console.log("RESOLVER=macos_keychain");
  } finally {
    secret.replace(/./g, "");
  }
}

void main().catch((error: unknown) => { console.error(`REGISTRATION_FAILED=${error instanceof Error ? error.message : "UNKNOWN"}`); process.exitCode = 1; });
