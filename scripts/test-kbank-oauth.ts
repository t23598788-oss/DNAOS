// Manual one-off test for the KBank OAuth2 client (Phase 1).
// NOT run in CI. Loads .env.local, calls getKBankAccessToken(slug), prints result.
// Run: npx tsx scripts/test-kbank-oauth.ts

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { promises as fs } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadEnvFile(envPath: string) {
  const raw = await fs.readFile(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("export ")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^\"|\"$/g, "");
    process.env[key] = val;
  }
}

async function main() {
  const envPath = resolve(__dirname, "..", ".env.local");
  await loadEnvFile(envPath);

  const baseUrl = process.env.KBANK_KGP_BASE_URL;
  const consumerId = process.env.KBANK_KGP_CONSUMER_ID;
  const consumerSecret = process.env.KBANK_KGP_CONSUMER_SECRET;
  const envId = process.env.KBANK_KGP_ENV_ID;

  console.log("KBank K API OAuth2 sandbox config");
  console.log("  baseUrl   :", baseUrl ?? "(missing)");
  console.log("  consumerId length:", consumerId ? consumerId.length : 0);
  console.log("  consumerSecret length:", consumerSecret ? consumerSecret.length : 0);
  console.log("  envId     :", envId ?? "(missing)");

  if (!consumerId || !consumerSecret || !baseUrl || !envId) {
    console.log("\nToken not requested: KBank credentials missing.");
    return;
  }

  try {
    const { getKBankAccessToken } = await import("../services/kbank/kapi-oauth");
    const token = await getKBankAccessToken("kbiz");
    console.log("\nToken: " + token.slice(0, 20) + "... (length: " + token.length + ")");
  } catch (err) {
    console.error("\nToken request failed:");
    console.error("  ", err instanceof Error ? err.message : String(err));
  }
}

main().catch((err) => {
  console.error("\nFatal:", err);
  process.exit(1);
});
