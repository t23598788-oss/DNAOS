# Unified Identity Hub — 3-Layer Omnichannel Architecture

## Layer 1 — Core User Identity (Master ID)

- `core_identities`: one row per real person/entity (Master ID).
- `identity_provider_accounts`: OAuth/social/channel identities linked to a Master ID.
- `auth_user_id` optionally links to Supabase Auth (`auth.users`).

## Layer 2 — Omnichannel Channel Bindings (Ingestion Gate)

- `partner_channel_bindings` is the ingestion gate.
- Each row maps a channel-specific ID (`LINE` user ID, `PHONE`, etc.) to one `core_identity_id`.
- Chat events in `line_events` are grouped by `line_user_id` and resolved through this binding.

## Layer 3 — Business Capabilities & Assets (Overlay)

- `identity_business_capabilities` overlays business assets onto a Master ID without coupling chat ingestion to business logic.
- Existing `partner_business_profile_id` on bindings is backfilled into this overlay.

## ER Diagram

```mermaid
erDiagram
    CORE_IDENTITIES ||--o{ IDENTITY_PROVIDER_ACCOUNTS : has
    CORE_IDENTITIES ||--o{ PARTNER_CHANNEL_BINDINGS : "master id"
    CORE_IDENTITIES ||--o{ IDENTITY_BUSINESS_CAPABILITIES : "overlay"
    PARTNER_CHANNEL_BINDINGS }o--|| IDENTITY_PROVIDER_ACCOUNTS : "provider account"
    IDENTITY_BUSINESS_CAPABILITIES }o--|| PARTNER_BUSINESS_PROFILES : "capability ref"

    CORE_IDENTITIES {
        uuid id PK
        uuid auth_user_id FK
        text master_type
        text master_display_name
        text master_avatar_url
        text primary_email
        text status
        jsonb metadata
    }

    IDENTITY_PROVIDER_ACCOUNTS {
        uuid id PK
        uuid core_identity_id FK
        text provider
        text provider_user_id
        text provider_display_name
        text provider_avatar_url
        text access_token
        text refresh_token
        timestamptz token_expires_at
        text[] scopes
        jsonb raw_profile
        boolean is_primary
    }

    PARTNER_CHANNEL_BINDINGS {
        uuid id PK
        uuid core_identity_id FK
        uuid provider_account_id FK
        text channel_type
        text channel_user_id
        text display_name
        text avatar_url
        uuid partner_business_profile_id
        text source
    }

    IDENTITY_BUSINESS_CAPABILITIES {
        uuid id PK
        uuid core_identity_id FK
        text capability_type
        uuid capability_ref_id
        text capability_ref_table
        jsonb metadata
    }

    PARTNER_BUSINESS_PROFILES {
        uuid id PK
        uuid pit_profile_id
        text business_category
        jsonb capabilities
    }
```

## Inbound Data Flow (LINE example)

```mermaid
flowchart TD
    A[LINE Webhook inbound event] --> B[line_events insert]
    B --> C{Binding exists for line_user_id?}
    C -- No --> D[Create partner_channel_bindings row]
    D --> E[Resolve or create core_identities Master ID]
    C -- Yes --> E
    E --> F[Upsert identity_provider_accounts with latest avatar/name/tokens]
    F --> G[Update partner_channel_bindings.core_identity_id + avatar_url]
    G --> H[Admin UI groups line_events by line_user_id]
    H --> I[Join core_identities + provider account for live avatar/name]
    I --> J{Has identity_business_capabilities?}
    J -- No --> K[Show as New Customer / Unidentified Lead]
    J -- Yes --> L[Show business overlay: quarry, plant, store, fleet]
```

## Notes

- Migration: `supabase/migrations/20261110190000_unified_identity_layer1_layer2.sql`
- Backfill created Master IDs for all existing channel bindings and LINE events with real IDs.
- Chat ingestion no longer depends on business profile existence.
