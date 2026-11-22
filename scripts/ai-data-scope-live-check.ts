/**
 * READ-ONLY DATA SCOPE CHECK — no platform-wide read path.
 *
 * Requires the configured Supabase client. Verifies that a caller with no
 * verified organization scope receives no company rows and that tenant reads
 * without a scope are rejected. It deliberately never counts or dumps all
 * companies.
 */
import { getPartners } from "@/services/supabase/queries";
import { NO_DATA_SCOPE } from "@/core/authority/data-scope";
import { dispatch } from "@/engines/validation/dispatcher";

async function main() {
  const rows = await getPartners(NO_DATA_SCOPE);
  if (rows.length !== 0) throw new Error(`Expected no-scope result to be empty; received ${rows.length} rows`);

  const denied = await dispatch("partner.list", {}, false);
  if (denied.ok || !denied.violations.join(" ").includes("DATA_SCOPE_REQUIRED")) {
    throw new Error(`Expected unscoped partner.list to be denied: ${denied.violations.join("; ")}`);
  }

  console.log("PASS: no business data is returned without a verified organization scope");
}

main().catch((error) => {
  console.error("FAIL:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
