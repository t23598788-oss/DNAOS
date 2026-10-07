/**
 * หน้าที่: the ONE real, production `AccountBindingProvider` implementation
 * for this capability — distinct from `./tests/adapter.test.ts`'s
 * in-memory fake. Honest, not mocked: `credentials/provider-accounts/
 * digitalocean/README.md` states plainly "no registry (create/get/list)
 * exists yet," so this implementation's only correct behavior is to
 * always resolve `undefined` — there is truly no binding anywhere to
 * find. This is what makes `../control/connector-execution-boundary/`'s
 * call into this adapter genuinely real rather than faked: it is a real
 * async function, on the real code path, that gives a real (negative)
 * answer today, and requires editing exactly this one file (not the
 * router, not the boundary) once a real binding registry exists.
 *
 * Input: `account_id`, `digitalocean_team_id`, `auth_method` (per
 * `./binding-provider.ts`'s interface).
 * Output: `productionAccountBindingProvider` (always resolves `undefined`
 * today).
 * Dependency ที่อนุญาต: ./binding-provider.ts (type only).
 * สิ่งที่ห้ามแตะ: never return a fabricated `AccountCredentialBinding`
 * here — the whole point of this file is to tell the truth about there
 * being no real registry yet, so `../digitalocean-adapter.ts` fails
 * closed (AUTH_REQUIRED) instead of a fake success.
 */

import type { AccountBindingProvider } from "./binding-provider";

export const productionAccountBindingProvider: AccountBindingProvider = {
  async resolve(): Promise<undefined> {
    // No real binding registry exists in this repo yet (see
    // credentials/provider-accounts/digitalocean/README.md). Returning
    // undefined here is the true, current state — not a placeholder.
    return undefined;
  },
};
