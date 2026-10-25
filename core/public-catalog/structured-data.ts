/**
 * JSON-LD builder for public catalog items — PURE, no I/O.
 *
 * Truthtelling rules (mission §06 — none of these may ever be synthesized):
 *   - no `aggregateRating`, no `review` — this system records no public reviews
 *   - no `geo`/`latitude`/`longitude` — pit coordinates are unverified PII
 *   - no `telephone` — pit_profiles.phone is not a published field
 *   - no `availability: InStock` unless the record carried real stock evidence
 *   - no price at all when no verified price exists (the page shows "ขอราคา")
 *   - `seller` is the SUPPLIER's name, never DNA OS: DNA OS publishes other
 *     organizations' listings and must not claim to be their seller.
 *
 * @type selection:
 *   material  → Product (+ Offer when a price is published)
 *   equipment → Product (rental/sale subject to quote; Offer only with price)
 *   transport → Service (a truck class is a service, not a physical good)
 */
import type { PublicCatalogView } from "./policy"

type JsonLd = Record<string, unknown>

const AVAILABILITY_IN_STOCK = "https://schema.org/InStock"

export function buildCatalogJsonLd(item: PublicCatalogView, baseUrl: string | null): JsonLd | null {
  if (!item.name) return null
  const url = baseUrl ? `${baseUrl}/products/${item.slug}` : undefined

  const offer: JsonLd | null =
    item.price && item.price.amount > 0
      ? {
          "@type": "Offer",
          price: item.price.amount.toFixed(2),
          priceCurrency: item.price.currency,
          ...(item.price.valid_until ? { priceValidUntil: item.price.valid_until } : {}),
          ...(item.availability === "in_stock" ? { availability: AVAILABILITY_IN_STOCK } : {}),
          ...(item.supplier ? { seller: { "@type": "Organization", name: item.supplier.name } } : {}),
          ...(url ? { url } : {}),
        }
      : null

  if (item.type === "transport") {
    return {
      "@context": "https://schema.org",
      "@type": "Service",
      name: item.name,
      serviceType: "transport",
      ...(item.spec ? { description: item.spec } : {}),
      ...(item.supplier ? { provider: { "@type": "Organization", name: item.supplier.name } } : {}),
      ...(item.service_area ? { areaServed: item.service_area } : {}),
      ...(url ? { url } : {}),
      ...(offer ? { offers: offer } : {}),
    }
  }

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: item.name,
    ...(item.category ? { category: item.category } : {}),
    ...(item.spec ? { description: item.spec } : {}),
    ...(item.unit ? { additionalProperty: { "@type": "PropertyValue", name: "unit", value: item.unit } } : {}),
    ...(item.image_url ? { image: item.image_url } : {}),
    ...(url ? { url } : {}),
    ...(offer ? { offers: offer } : {}),
  }
}
