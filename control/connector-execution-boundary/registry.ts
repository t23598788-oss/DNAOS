/**
 * หน้าที่: the ONE place a provider's real `ConnectorInvoker` is
 * registered against its `capability_id` — this is the extension point
 * Section 12 (Owner correction, 2026-08-22) requires: "เพิ่ม
 * provider/source/adapter ไม่ใช่สร้าง pipeline ใหม่ทุกบริษัท". Adding
 * RunPod/AWS/GCP/Azure later means adding one more entry here plus that
 * provider's own `*-router-invoker.ts` file — never a second boundary,
 * never a router.ts change.
 *
 * Input: none (module-level constant).
 * Output: `CONNECTOR_INVOKER_REGISTRY`, `getConnectorInvoker`.
 * Dependency ที่อนุญาต: ./types.ts,
 * ../../connections/digitalocean/router-invoker.ts,
 * ../../connections/railway/router-invoker.ts,
 * ../../connections/google-workspace/router-invoker.ts
 * (each provider's one documented public entry point).
 * สิ่งที่ห้ามแตะ: never import a provider's internal binding/credential
 * provider files here — only the provider's own already-composed
 * `ConnectorInvoker` function, per Capability Folder Law ข้อ 9.
 */

import type { ConnectorInvoker } from "./types";
import { invokeDigitalOceanConnector } from "../../connections/digitalocean/router-invoker";
import { invokeRailwayConnector } from "../../connections/railway/router-invoker";
import { invokeGoogleWorkspaceConnector } from "../../connections/google-workspace/router-invoker";

export const CONNECTOR_INVOKER_REGISTRY: Readonly<Record<string, ConnectorInvoker>> = {
  digitalocean: invokeDigitalOceanConnector,
  railway: invokeRailwayConnector,
  "google-workspace": invokeGoogleWorkspaceConnector,
};

export function getConnectorInvoker(capability_id: string): ConnectorInvoker | undefined {
  return CONNECTOR_INVOKER_REGISTRY[capability_id];
}
