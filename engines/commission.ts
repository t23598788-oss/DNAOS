/**
 * The ONE platform-commission reader (owner decision, Model B).
 *
 * `pit_materials.price` is the partner's BASE price — what the partner must
 * receive. DNA OS adds a Platform Commission on top of it (and on top of the
 * transport leg) and keeps the difference. It does not buy the goods.
 *
 * The rate is BUSINESS POLICY, not a constant: it lives in
 * `app_configs."pricing-markup-percent"` so it can change without a deploy.
 * It must never be hardcoded at a call site — that is exactly how the old
 * `MARKUP_MULTIPLIER = 1.25` drifted away from config in the first place.
 *
 * FAIL CLOSED: if the key is missing, empty, non-numeric, negative or
 * non-finite, this throws. It never falls back to 1.25 — pricing with a
 * guessed rate is worse than refusing to price.
 *
 * Reads through `core/config-loader.ts`'s `loadConfigs()`, so it shares that
 * module's 60s TTL cache rather than adding a second config store. A short TTL
 * (not indefinite) is required: the rate is policy and must be able to change
 * without a restart.
 *
 * See docs/PRICING_DOMAIN.md §4 (who sets the rate) and §5 (the only
 * arithmetic DNA OS is permitted to perform).
 */

import { loadConfigs } from "@/core/config-loader";
import { supabaseAdmin } from "@/services/supabase/queries";

export const COMMISSION_CONFIG_KEY = "pricing-markup-percent";

const FAIL_CLOSED_MESSAGE = "pricing-markup-percent not configured — refusing to price";

/**
 * Current Platform Commission as a FRACTION (config 25 -> 0.25).
 *
 * @throws Error("pricing-markup-percent not configured — refusing to price")
 *         when the value is absent or invalid.
 */
export async function readCommissionRate(): Promise<number> {
  let configs: Awaited<ReturnType<typeof loadConfigs>>;

  try {
    configs = await loadConfigs(supabaseAdmin());
  } catch (e) {
    // A failed config read is still "we do not know the rate" — fail closed,
    // but keep the real cause visible in logs instead of swallowing it.
    console.error(
      `[commission] config read failed — ${e instanceof Error ? e.message : String(e)}`,
    );
    throw new Error(FAIL_CLOSED_MESSAGE);
  }

  const raw = configs[COMMISSION_CONFIG_KEY];

  // loadConfigs() preserves numeric-looking strings that would not round-trip
  // (e.g. "25.00", leading zeros on tax ids), so accept an explicit numeric
  // string too — but never treat "" or junk as a rate (""
  // would coerce to 0 via Number()).
  const isBlank =
    raw === undefined ||
    raw === null ||
    (typeof raw === "string" && raw.trim() === "");
  const percent = isBlank ? NaN : Number(typeof raw === "string" ? raw.trim() : raw);

  if (!Number.isFinite(percent) || percent < 0) {
    throw new Error(FAIL_CLOSED_MESSAGE);
  }

  return percent / 100;
}
