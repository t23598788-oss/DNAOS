/**
 * Provider presentation metadata owned by the connection layer.
 * This is not provider state and is not a second provider registry: identity,
 * connection state, credentials, and availability remain in their existing
 * registries. Consumers must only use an entry when the provider identity was
 * resolved by an existing connection declaration.
 */

export interface ProviderMetadata {
  readonly provider_id: string;
  readonly brand_slug: string;
  readonly brand_icon_url: string;
  readonly brand_icon_source: "simple-icons";
  readonly source: "connection-provider-metadata";
}

const PROVIDER_METADATA: Readonly<Record<string, ProviderMetadata>> = {
  github: {
    provider_id: "github",
    brand_slug: "github",
    brand_icon_url: "https://cdn.simpleicons.org/github",
    brand_icon_source: "simple-icons",
    source: "connection-provider-metadata",
  },
  digitalocean: {
    provider_id: "digitalocean",
    brand_slug: "digitalocean",
    brand_icon_url: "https://cdn.simpleicons.org/digitalocean",
    brand_icon_source: "simple-icons",
    source: "connection-provider-metadata",
  },
  supabase: {
    provider_id: "supabase",
    brand_slug: "supabase",
    brand_icon_url: "https://cdn.simpleicons.org/supabase",
    brand_icon_source: "simple-icons",
    source: "connection-provider-metadata",
  },
};

export function providerMetadataFor(providerId: string): ProviderMetadata | null {
  return PROVIDER_METADATA[providerId] ?? null;
}
