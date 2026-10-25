/**
 * Country Package Foundation (owner, 2026-08-07, Software Factory
 * Step 10, Phase 7). This is a FRAMEWORK ONLY — no real Country Package
 * exists anywhere in this repo yet, and this file creates none. It
 * declares the real TypeScript contracts a future real Country Package
 * (Legal/Tax/Document/Business Rules/Localization/Capability Extension)
 * would have to satisfy, and a real, honest status registry that always
 * reports NOT_IMPLEMENTED for every country until a real package is
 * actually built and registered here.
 *
 * Constitution Principle 4 — Country Package Architecture: legal, tax,
 * document, and business rules for each country must be a separate
 * Package, never hardcoded into Core.
 */

export interface CountryMetadata {
  countryCode: string; // ISO 3166-1 alpha-2
  countryName: string;
  currency: string; // ISO 4217
  languages: string[];
  legalSystem: string;
}

export interface LegalPackageContract {
  countryCode: string;
  entityTypes: string[];
  requiredRegistrations: string[];
  evidenceSource: string;
}
export interface TaxPackageContract {
  countryCode: string;
  taxTypes: string[]; // e.g. VAT, withholding tax
  rates: Record<string, number>;
  filingSchedule: string;
  evidenceSource: string;
}
export interface DocumentPackageContract {
  countryCode: string;
  requiredDocumentTypes: string[]; // e.g. invoice, receipt, tax-invoice
  numberingRules: string;
  evidenceSource: string;
}
export interface BusinessRulesPackageContract {
  countryCode: string;
  rules: string[];
  evidenceSource: string;
}
export interface LocalizationPackageContract {
  countryCode: string;
  language: string;
  dateFormat: string;
  numberFormat: string;
  evidenceSource: string;
}
export interface CapabilityExtensionPackageContract {
  countryCode: string;
  extendsCapabilityIds: string[]; // real CapabilityIds from registry/capability-registry.json this package extends
  evidenceSource: string;
}

export interface CountryPackage {
  metadata: CountryMetadata;
  legal: LegalPackageContract | null;
  tax: TaxPackageContract | null;
  document: DocumentPackageContract | null;
  businessRules: BusinessRulesPackageContract | null;
  localization: LocalizationPackageContract | null;
  capabilityExtension: CapabilityExtensionPackageContract | null;
  status: "NOT_IMPLEMENTED";
}

/** Real, honest, empty registry — no real Country Package has been built
 * yet. Adding a real entry here is the ONLY way a real Country Package
 * can ever exist; never fabricated, never guessed READY. */
export const COUNTRY_PACKAGE_REGISTRY: Record<string, CountryPackage> = {};

export function listCountryPackages(): CountryPackage[] {
  return Object.values(COUNTRY_PACKAGE_REGISTRY);
}
export function getCountryPackage(countryCode: string): CountryPackage | undefined {
  return COUNTRY_PACKAGE_REGISTRY[countryCode];
}
/** Real, deterministic framework status — always NOT_IMPLEMENTED until a
 * real Country Package is registered in COUNTRY_PACKAGE_REGISTRY above. */
export function getCountryPackageFrameworkStatus(): { registeredCountries: number; status: "NOT_IMPLEMENTED" | "PARTIAL"; evidence: string } {
  const count = Object.keys(COUNTRY_PACKAGE_REGISTRY).length;
  return {
    registeredCountries: count,
    status: count === 0 ? "NOT_IMPLEMENTED" : "PARTIAL",
    evidence: count === 0
      ? "real COUNTRY_PACKAGE_REGISTRY is empty — this is a real, honest framework only, no real Country Package exists"
      : `real COUNTRY_PACKAGE_REGISTRY has ${count} real registered countr(y/ies)`,
  };
}
