# Semantic Identity & Discovery V1

Bluetooth-style **architectural** principle only (TYPE → DISCOVERY → MATCH → RELATIONSHIP → OBSERVATION).  
Not a Bluetooth stack. No radio libraries.

## Law

- Existing registries remain authoritative.
- This folder produces a **derived, non-authoritative, rebuildable** graph.
- AI may explain results; AI must not invent relationships.
- Exact `SemanticId` match only.

## CLI

```bash
npm run semantic -- resolve capability://runtime/endpoint-resolution
npm run semantic -- impact capability://runtime/node-classification
npm run semantic -- doctor
```

## Pilot scope

Runtime Steps 1–8 foundation IDs only. See `pilot-descriptors.ts`.
