import { MacOsKeychainProvider } from "../macos-keychain/provider";
import type { KeychainResolution } from "../macos-keychain/types";
import { findDatabaseCredential, type DatabaseCredentialEntry } from "./database-credential-registry";

export interface DatabaseCredentialLookup {
  findDatabaseCredential(credential_ref: string): DatabaseCredentialEntry | null;
}

/**
 * Resolves a registered reference only; secret material stays inside this
 * call. Service/account always come from the persisted registry entry —
 * never guessed or parsed from the credential_ref string itself — and
 * there is no environment-variable or hardcoded-credential fallback path.
 *
 * `lookup` defaults to the real persistent Database Credential Registry;
 * tests may inject an isolated one instead.
 */
export class DatabaseCredentialResolver {
  constructor(
    private readonly keychain = new MacOsKeychainProvider(),
    private readonly lookup: DatabaseCredentialLookup = { findDatabaseCredential },
  ) {}

  resolve(credential_ref: string): Promise<KeychainResolution> {
    const entry = this.lookup.findDatabaseCredential(credential_ref);

    // Unregistered reference — distinct from a Keychain lookup failure
    // below: credential_source here is the raw credential_ref, never a
    // "keychain:service/account" source, because no Keychain call was
    // ever attempted.
    if (!entry) {
      return Promise.resolve({ ok: false, code: "NOT_FOUND", reason: "CREDENTIAL_NOT_REGISTERED", credential_source: credential_ref });
    }

    // Registered but not ACTIVE (revoked/disabled) — rejected without
    // ever attempting a Keychain call, and distinguishable by reason from
    // both "not registered" above and any Keychain-side failure below.
    if (entry.status !== "ACTIVE") {
      return Promise.resolve({ ok: false, code: "FAILED", reason: `CREDENTIAL_${entry.status}`, credential_source: credential_ref });
    }

    // Registered and ACTIVE — only now does a real Keychain lookup run,
    // using exactly the service/account this entry was registered with.
    // If the Keychain item itself is missing, MacOsKeychainProvider
    // returns credential_source "keychain:<service>/<account>", which is
    // how that failure stays distinguishable from "registry missing"
    // above without needing a new failure code.
    return this.keychain.resolve({ service: entry.resolver_service, account: entry.resolver_account, kind: "password" });
  }
}
