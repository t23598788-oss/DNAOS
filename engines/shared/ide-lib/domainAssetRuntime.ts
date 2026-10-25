/**
 * Domain Asset Registry Runtime (owner, 2026-08-08, Software Factory
 * Step 13.7). Real, Owner-only registry of domains the Owner declares
 * as real assets — the safety boundary for the entire External Attack
 * Surface Discovery Engine. NOTHING in externalAttackSurfaceRuntime.ts
 * may target a domain that is not registered AND explicitly verified
 * here. Registration alone is NOT enough — verification is a separate,
 * real, explicit Owner action (mirrors Section 5's "ห้าม Execute กับ
 * Target ที่ไม่มีข้อมูล" principle from Step 13.25).
 */
import { randomUUID } from "crypto";
import { createOperationsArtifact } from "./artifactRuntime";

export interface DomainAsset {
  domainAssetId: string;
  domain: string;
  organization: string;
  purpose: string;
  authorization: string;
  allowedRuntime: string[];
  forbiddenRuntime: string[];
  /** Real, Owner-declared subdomains the Owner already knows should
   * exist (their own real inventory) — the "Registry" layer of the
   * real Source Code -> Registry -> DNS -> Public Internet comparison.
   * Never guessed, never inferred — only what the Owner explicitly typed. */
  expectedSubdomains: string[];
  registeredAt: string;
  ownerId: string;
  actor: string;
  verified: boolean;
  verifiedAt: string | null;
  verificationMethod: string | null;
  artifactIds: string[];
}

export class DomainAssetError extends Error {
  code: "ASSET_NOT_FOUND" | "ASSET_NOT_OWNED" | "ASSET_ALREADY_VERIFIED" | "ASSET_ALREADY_EXISTS" | "INVALID_REQUEST";
  constructor(code: typeof DomainAssetError.prototype.code, message: string) { super(message); this.code = code; this.name = "DomainAssetError"; }
}

const assets = new Map<string, DomainAsset>();
const MAX_ASSET_HISTORY = 500;
function evictOld(ownerId: string) {
  const owned = [...assets.values()].filter((a) => a.ownerId === ownerId).sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
  while (owned.length > MAX_ASSET_HISTORY) { const oldest = owned.shift()!; assets.delete(oldest.domainAssetId); }
}

/** Real, deterministic domain shape validation — never a network call,
 * just real syntax sanity (RFC-ish hostname check). */
function isValidDomainSyntax(domain: string): boolean {
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i.test(domain.trim());
}

export function registerDomainAsset(input: { domain: string; organization: string; purpose: string; authorization: string; allowedRuntime: string[]; forbiddenRuntime: string[]; expectedSubdomains?: string[] }, ownerId: string, actor: string): DomainAsset {
  const domain = input.domain.trim().toLowerCase();
  if (!isValidDomainSyntax(domain)) throw new DomainAssetError("INVALID_REQUEST", `"${input.domain}" is not a real, syntactically valid domain`);
  if (!input.organization.trim() || !input.purpose.trim() || !input.authorization.trim()) throw new DomainAssetError("INVALID_REQUEST", "real organization/purpose/authorization are all required — never left blank");
  if ([...assets.values()].some((a) => a.ownerId === ownerId && a.domain === domain)) throw new DomainAssetError("ASSET_ALREADY_EXISTS", `"${domain}" is already a real, registered asset for this owner`);

  const domainAssetId = randomUUID();
  const asset: DomainAsset = {
    domainAssetId, domain, organization: input.organization, purpose: input.purpose, authorization: input.authorization,
    allowedRuntime: input.allowedRuntime, forbiddenRuntime: input.forbiddenRuntime,
    expectedSubdomains: (input.expectedSubdomains ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean),
    registeredAt: new Date().toISOString(), ownerId, actor, verified: false, verifiedAt: null, verificationMethod: null, artifactIds: [],
  };
  const artifact = createOperationsArtifact({ artifactType: "DOMAIN_ASSET_RECORD", content: JSON.stringify(asset), mimeType: "application/json", actor, ownerId, generatedFrom: domainAssetId, jobId: null });
  asset.artifactIds.push(artifact.artifactId);
  assets.set(domainAssetId, asset);
  evictOld(ownerId);
  return asset;
}

/** Real, explicit, separate Owner verification action — the ONLY thing
 * that ever flips `verified` to true. Registration alone never implies
 * verification (Section 5 of Step 13.25's mandate, reapplied here). */
export function verifyDomainAsset(domainAssetId: string, ownerId: string, verificationMethod: string): DomainAsset {
  const asset = getDomainAsset(domainAssetId, ownerId);
  if (asset.verified) throw new DomainAssetError("ASSET_ALREADY_VERIFIED", "this real domain asset is already verified");
  if (!verificationMethod.trim()) throw new DomainAssetError("INVALID_REQUEST", "a real verificationMethod description is required (e.g. DNS TXT record, registry cross-reference)");
  asset.verified = true;
  asset.verifiedAt = new Date().toISOString();
  asset.verificationMethod = verificationMethod;
  return asset;
}

/** Real, Owner-only update of the real, expected-subdomain inventory —
 * the "Registry" layer used by the real 4-layer External Drift
 * comparison. */
export function updateExpectedSubdomains(domainAssetId: string, ownerId: string, expectedSubdomains: string[]): DomainAsset {
  const asset = getDomainAsset(domainAssetId, ownerId);
  asset.expectedSubdomains = expectedSubdomains.map((s) => s.trim().toLowerCase()).filter(Boolean);
  return asset;
}

export function getDomainAsset(domainAssetId: string, ownerId: string): DomainAsset {
  const a = assets.get(domainAssetId);
  if (!a) throw new DomainAssetError("ASSET_NOT_FOUND", "no real domain asset with that id");
  if (a.ownerId !== ownerId) throw new DomainAssetError("ASSET_NOT_OWNED", "this domain asset belongs to a different owner");
  return a;
}
export function listDomainAssets(ownerId: string): DomainAsset[] {
  return [...assets.values()].filter((a) => a.ownerId === ownerId).sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
}
export function __debugDomainAssetCount(): number { return assets.size; }
