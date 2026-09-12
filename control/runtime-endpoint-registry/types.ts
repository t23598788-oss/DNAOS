/**
 * หน้าที่: leaf types for runtime listen-URL registration.
 *
 * This is not ServiceDefinition, not ConnectionDeclaration, not
 * RepositoryRegistration, not a provider project row.
 *
 * Input: none.
 * Output: RuntimeEndpointRegistration and resolution result types.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: ห้ามใส่ railway_* / vercel_* / provider_name / secret /
 * repository_root / machine path เป็น field ของ canonical record.
 */

/** Existing runtime-control ServiceId reused as identity. Not a parallel catalog. */
export type RuntimeServiceId = string;

export type RuntimeEndpointScope = "CORE_LOCAL" | "MAC_LOCAL" | "PUBLIC";
export type RuntimeEndpointTransport = "HTTP" | "HTTPS" | "STDIO";
export type RuntimeEndpointSource = "NODE_LOCAL" | "REGISTERED_REMOTE";
export type RuntimeEndpointStatus = "ACTIVE" | "DRAINING" | "DISABLED";

/** execute = traffic; observe = health/evidence (DRAINING allowed). */
export type RuntimeEndpointPurpose = "execute" | "observe";

export interface RuntimeEndpointRegistration {
  readonly endpoint_id: string;
  readonly service_id: RuntimeServiceId;
  readonly scope: RuntimeEndpointScope;
  readonly transport: RuntimeEndpointTransport;
  readonly address: string;
  readonly health_path: string | null;
  readonly source: RuntimeEndpointSource;
  readonly status: RuntimeEndpointStatus;
}

export type RuntimeEndpointFailReason =
  | "UNKNOWN_ENDPOINT"
  | "AMBIGUOUS_ENDPOINT"
  | "ENDPOINT_DISABLED"
  | "ENDPOINT_DRAINING"
  | "INVALID_QUERY";

export type RuntimeEndpointResolution =
  | { readonly ok: true; readonly endpoint: RuntimeEndpointRegistration; readonly reason: null }
  | { readonly ok: false; readonly endpoint: null; readonly reason: RuntimeEndpointFailReason };
