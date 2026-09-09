/**
 * Provider brand asset system — hermetic proofs.
 * How to run: npx tsx connections/connection-registry/tests/provider-brand-assets.test.ts
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DNA_OS_MASTER_BRAND_ASSET_REF,
  GENERIC_INTEGRATION_BRAND_ASSET_REF,
  listProviderMetadata,
  providerMetadataFor,
} from "../provider-metadata";
import {
  resolveCapabilityBrand,
  resolveConnectionBrand,
  resolveProviderBrandAsset,
  resolveToolBrand,
} from "../brand-asset-resolver";
import { getRemoteServiceBinding } from "../../../control/local-resource-access/remote-service-binding";
import { GOOGLE_CONNECTION_ID, GOOGLE_CREDENTIAL_REF } from "../../google-workspace/contract";

declare const process: { exitCode?: number };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function check(name: string, body: () => void): void {
  try {
    body();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSET_ROOT = join(HERE, "..", "brand-assets");

function main(): void {
  check("1. Google Workspace parent resolves brand metadata (official source recorded)", () => {
    const meta = providerMetadataFor("google");
    assert(meta !== null, "google meta");
    assert(meta!.display_name === "Google Workspace", meta!.display_name);
    assert(meta!.official_brand_source_ref !== null, "source ref");
    const resolved = resolveConnectionBrand("google");
    assert(resolved.provider_id === "google", resolved.provider_id);
    assert(resolved.remote_render_url === null, "no hotlink");
    // Official file not imported yet → fallback
    assert(resolved.fallback_used === true, "fallback until Owner import");
    assert(resolved.brand_asset_ref === GENERIC_INTEGRATION_BRAND_ASSET_REF, resolved.brand_asset_ref);
  });

  check("2. Gmail resolves Gmail brand id (not parent G)", () => {
    const r = resolveCapabilityBrand("service://google/gmail");
    assert(r.provider_id === "google-gmail", r.provider_id);
    assert(r.display_name === "Gmail", r.display_name);
    assert(r.parent_provider_id === "google", String(r.parent_provider_id));
  });

  check("3. Calendar resolves Calendar brand id", () => {
    const r = resolveCapabilityBrand("service://google/calendar");
    assert(r.provider_id === "google-calendar", r.provider_id);
    assert(r.display_name === "Google Calendar", r.display_name);
  });

  check("4. Drive resolves Drive brand id", () => {
    const r = resolveCapabilityBrand("service://google/drive");
    assert(r.provider_id === "google-drive", r.provider_id);
  });

  check("5. Sheets resolves Sheets brand id", () => {
    const r = resolveCapabilityBrand("service://google/sheets");
    assert(r.provider_id === "google-sheets", r.provider_id);
  });

  check("6. Supabase resolves Supabase brand metadata", () => {
    const meta = providerMetadataFor("supabase");
    assert(meta !== null && meta.display_name === "Supabase", JSON.stringify(meta));
    const r = resolveConnectionBrand("supabase");
    assert(r.provider_id === "supabase", r.provider_id);
    assert(r.official_brand_source_ref?.includes("supabase.com") === true, String(r.official_brand_source_ref));
  });

  check("7. same provider returns same canonical asset ref everywhere", () => {
    const a = resolveConnectionBrand("google-gmail").brand_asset_ref;
    const b = resolveToolBrand("google-gmail").brand_asset_ref;
    const c = resolveCapabilityBrand("google-gmail").brand_asset_ref;
    assert(a === b && b === c, `${a} vs ${b} vs ${c}`);
  });

  check("8. unknown provider uses neutral fallback", () => {
    const r = resolveProviderBrandAsset("provider-does-not-exist");
    assert(r.fallback_used === true, "fallback");
    assert(r.brand_asset_ref === GENERIC_INTEGRATION_BRAND_ASSET_REF, r.brand_asset_ref);
    assert(r.asset_state === "MISSING_OFFICIAL_ASSET", r.asset_state);
  });

  check("9. no random remote asset URL is rendered", () => {
    for (const id of ["google", "google-gmail", "supabase", "github", "unknown-x"]) {
      const r = resolveProviderBrandAsset(id);
      assert(r.remote_render_url === null, id);
      assert(!r.brand_asset_ref.startsWith("http"), id);
      assert(!r.brand_asset_ref.includes("cdn.simpleicons.org"), id);
    }
  });

  check("10. no provider logo is embedded as base64 in source", () => {
    const metaSrc = readFileSync(join(HERE, "..", "provider-metadata.ts"), "utf8");
    const resolverSrc = readFileSync(join(HERE, "..", "brand-asset-resolver.ts"), "utf8");
    assert(!/data:image\//.test(metaSrc + resolverSrc), "no data:image");
    assert(!/base64,[A-Za-z0-9+/=]{40,}/.test(metaSrc + resolverSrc), "no base64 blob");
  });

  check("11. no duplicated provider asset copies under brand-assets", () => {
    const files: string[] = [];
    function walk(dir: string): void {
      if (!existsSync(dir)) return;
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) walk(p);
        else if (name.name.endsWith(".svg") || name.name.endsWith(".png")) files.push(p);
      }
    }
    walk(ASSET_ROOT);
    const hashes = new Map<string, string>();
    for (const f of files) {
      const h = createHash("sha256").update(readFileSync(f)).digest("hex");
      if (hashes.has(h)) throw new Error(`duplicate asset content: ${hashes.get(h)} and ${f}`);
      hashes.set(h, f);
    }
    assert(files.length >= 1, "generic present");
  });

  check("12. light/dark resolution respects declared variants (no auto-recolor)", () => {
    const dark = resolveProviderBrandAsset("google-drive", { preferred_variant: "DARK_BACKGROUND" });
    assert(dark.diagnostics === null || dark.diagnostics.includes("NEUTRAL_CONTAINER") || dark.diagnostics.includes("DARK"), String(dark.diagnostics));
    assert(dark.background_requirement === "NEUTRAL_CONTAINER" || dark.asset_variant === "FULL_COLOR", "no invent");
  });

  check("13. provider brand metadata does not affect auth/capability semantics", () => {
    const before = getRemoteServiceBinding("service://google/gmail");
    assert(before !== null, "binding");
    // Resolving brand must not mutate binding
    resolveCapabilityBrand("service://google/gmail");
    const after = getRemoteServiceBinding("service://google/gmail");
    assert(after!.connection_id === GOOGLE_CONNECTION_ID, "connection unchanged");
    assert(after!.credential_ref === GOOGLE_CREDENTIAL_REF, "credential unchanged");
    assert(after!.availability === before!.availability, "availability unchanged");
    assert(JSON.stringify(after!.write_scope) === JSON.stringify(before!.write_scope), "write_scope");
  });

  check("14. DNA OS internal capability never impersonates provider branding", () => {
    const calc = providerMetadataFor("calculator")!;
    assert(calc.hierarchy === "DNA_OS_INTERNAL_CAPABILITY", calc.hierarchy);
    assert(calc.official_brand_asset_ref === GENERIC_INTEGRATION_BRAND_ASSET_REF, "generic");
    assert(!calc.usage_notes.toLowerCase().includes("gmail"), "no impersonation");
    const gmail = providerMetadataFor("google-gmail")!;
    assert(gmail.hierarchy === "EXTERNAL_PROVIDER", "external");
    assert(gmail.provider_id !== calc.provider_id, "distinct");
  });

  check("15. DNA OS D master mark is never used as external provider substitute", () => {
    for (const id of [
      "google", "google-gmail", "google-drive", "supabase", "github", "railway", "line", "meta", "instagram", "tiktok",
      "unknown-provider",
    ]) {
      const r = resolveProviderBrandAsset(id);
      assert(r.brand_asset_ref !== DNA_OS_MASTER_BRAND_ASSET_REF, `${id} must not use DNA OS D`);
      assert(!String(r.brand_asset_ref).includes("dna-os-mark-d"), `${id} path`);
    }
    const master = resolveProviderBrandAsset("dna-os");
    assert(master.hierarchy === "DNA_OS_MASTER_BRAND", "master hierarchy");
    assert(master.brand_asset_ref === DNA_OS_MASTER_BRAND_ASSET_REF, "D mark for dna-os only");
    assert(master.local_file_exists === true, "D mark file present");
  });

  check("bonus: four Google children have distinct provider_ids", () => {
    const ids = ["google-gmail", "google-calendar", "google-drive", "google-sheets"].map((id) => providerMetadataFor(id)!.provider_id);
    assert(new Set(ids).size === 4, ids.join(","));
  });

  check("bonus: generic local file exists and is SVG", () => {
    const p = join(ASSET_ROOT, "generic", "dna-os-integration-generic.svg");
    assert(existsSync(p), p);
    const body = readFileSync(p, "utf8");
    assert(body.includes("<svg"), "svg");
    assert(!body.toLowerCase().includes("gmail"), "not a provider mark");
    const hash = createHash("sha256").update(body).digest("hex");
    console.log(`NOTE GENERIC_ASSET_HASH=${hash}`);
  });

  check("bonus: listProviderMetadata includes core slots", () => {
    const ids = new Set(listProviderMetadata().map((m) => m.provider_id));
    for (const id of ["supabase", "github", "google", "vercel", "railway", "n8n", "line", "tiktok", "gemini", "chatgpt", "vscode"]) {
      assert(ids.has(id), `missing slot ${id}`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
