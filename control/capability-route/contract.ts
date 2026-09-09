/**
 * หน้าที่: ตอบคำถามเดียวให้ Owner Application — "capability นี้อยู่ที่ไหน และ
 * เรียกยังไง" โดยรวมสิ่งที่ทะเบียนเดิมรู้อยู่แล้วเข้าด้วยกัน (Owner, 2026-09-02).
 *
 * ไม่ใช่ทะเบียนตัวที่สอง. ไฟล์นี้ไม่เก็บอะไรเลย ไม่มี store เป็นของตัวเอง และ
 * ไม่มีสิทธิ์ประกาศว่าอะไรมีตัวตน มันอ่านจากของเดิมสี่ที่ที่มีเจ้าของอยู่แล้ว:
 *
 *   canonical capabilities/resources  — ตัวตนและ source pointer
 *   resource_capabilities             — รอยต่อ capability -> resource
 *   machine-observation runtime-targets — service ที่รันในเครื่องนี้
 *   connection-registry declarations    — ปลายทางนอกเครื่อง (endpoint/protocol/credential ref)
 *
 * ทำไมต้องมีชั้นนี้. วันนี้ Owner Application รู้จัก backend เดียวคือ Core ที่
 * hardcode ไว้ใน core-endpoints.mjs ทุก capability อื่นถึงจะมีตัวตนใน registry
 * ก็ยัง "หาไม่เจอและเรียกไม่ได้" เพราะไม่มีใครแปลง capability_id เป็นที่อยู่ที่
 * ยิงได้จริง ชั้นนี้คือการแปลงนั้น — และเป็นการ join ไม่ใช่การประกาศ
 *
 * GENERIC โดยบังคับ. ไม่มีชื่อ provider, ไม่มีชื่อ workflow, ไม่มี LINE, ไม่มี
 * เอกสาร, ไม่มีการเงินอยู่ในไฟล์นี้ capability ใหม่ที่ลงทะเบียนถูกต้องต้อง
 * resolve ได้ทันทีโดยไม่ต้องแก้ไฟล์นี้ ถ้าวันไหนต้องแก้ไฟล์นี้เพื่อรองรับ
 * capability ใหม่หนึ่งตัว แปลว่าชั้นนี้ผิดแล้ว
 *
 * FAIL CLOSED. ถ้าไม่รู้ว่ามันอยู่ไหน ต้องตอบว่าไม่รู้พร้อมเหตุผลที่ระบุได้
 * ห้ามเดา host, ห้ามเดา port, ห้ามเติม path ที่ไม่มีใครประกาศ — เพราะที่อยู่ที่
 * เดาขึ้นมาจะพา Owner ไปยิงของผิดตัวโดยไม่มีใครรู้
 *
 * ห้ามคืนความลับ. `credential_ref` เป็น "ตัวชี้" ไปยัง Keychain เท่านั้น
 * ไฟล์นี้ไม่เคยอ่านค่าจริงของ credential และต้องไม่มีวันอ่าน
 *
 * Input: ตัวอ้างอิง capability + แถวจากทะเบียนเดิม
 * Output: resolveCapabilityRoute, CapabilityRoute, RouteOutcome
 * Dependency ที่อนุญาต: none — pure
 * สิ่งที่ห้ามแตะ: ห้าม hardcode ชื่อ capability/provider ใด ๆ, ห้ามเดา endpoint,
 * ห้ามคืนค่า credential จริง, ห้ามเขียนลงทะเบียนใด.
 */

/** ผลของการ resolve หนึ่งครั้ง — ไม่มีสถานะที่แปลว่า "น่าจะใช่" */
export type RouteOutcome =
  | "ROUTE_RESOLVED"
  /** ไม่มี capability ชื่อ/ไอดีนี้ในทะเบียน canonical */
  | "NO_CANONICAL_IDENTITY"
  /** มีตัวตน แต่ไม่มีใครประกาศว่ามันรันที่ไหน */
  | "NO_RUNTIME_BINDING"
  /** มีมากกว่าหนึ่งที่อยู่ และไม่มีกฎที่บอกได้ว่าอันไหนถูก — ไม่เลือกเอง */
  | "RUNTIME_BINDING_AMBIGUOUS";

/** ที่อยู่มาจากไหน — local service ในเครื่อง หรือปลายทางนอกเครื่อง */
export type RuntimeKind = "LOCAL_SERVICE" | "OUTBOUND_CONNECTION";

export interface CapabilityRoute {
  capability_id: string;
  canonical_name: string;
  /** ที่อยู่ของ source จริง — อาจอยู่คนละ repository และนั่นถูกต้อง */
  source_pointer: readonly string[];
  runtime_kind: RuntimeKind;
  /** ที่อยู่ที่ยิงได้จริง เช่น http://127.0.0.1:5181 หรือ https://... */
  address: string;
  protocol: string;
  /** path สำหรับตรวจว่ามันยังมีชีวิต — null เมื่อไม่มีใครประกาศไว้ */
  health_path: string | null;
  /** ตัวชี้ไป Keychain เท่านั้น ไม่ใช่ค่าจริง */
  credential_ref: string | null;
  /** อำนาจที่ประกาศไว้กับ runtime นั้น เช่น OBSERVE_ONLY */
  authority: string;
  evidence_refs: readonly string[];
  /** ทะเบียนไหนบ้างที่ตอบคำถามนี้ — provenance ของคำตอบ */
  resolved_from: readonly string[];
}

/**
 * ตัวตนที่รู้แล้ว แยกออกจากที่อยู่ที่ยังไม่รู้
 *
 * capability หนึ่งตัวอาจ "มีตัวตนและรู้ว่า source อยู่ไหน" แต่ "ยังไม่รู้ว่ารันที่ไหน"
 * ได้พร้อมกัน ถ้าคืนแต่ null เมื่อ route ไม่สำเร็จ หน้าจอจะแสดงได้แค่ว่าไม่รู้จัก
 * ทั้งที่ระบบรู้จักมันดี — ซึ่งไม่จริงและทำให้ Owner หา source เองไม่ได้
 */
export interface CapabilityIdentity {
  capability_id: string;
  canonical_name: string;
  source_pointer: readonly string[];
  has_runtime_pointer: boolean;
}

export interface RouteResolution {
  query: string;
  outcome: RouteOutcome;
  route: CapabilityRoute | null;
  /** มีค่าเสมอเมื่อ capability มีตัวตน แม้ route จะยังไม่สำเร็จ */
  identity: CapabilityIdentity | null;
  /** เหตุผลที่ระบุได้เสมอเมื่อ resolve ไม่ได้ */
  reason: string | null;
  resolved_at: string;
}

/** แถวเท่าที่ resolver ต้องใช้ — ตั้งใจให้แคบ จะได้ไม่ผูกกับ schema เต็มของใคร */
export interface CapabilityRow { capability_id: string; canonical_name: string; status?: string }
export interface ResourceRow { resource_id: string; source_location?: string | null }
export interface ResourceCapabilityRow { capability_id: string; resource_id: string }
export interface RuntimeTargetRow {
  runtime_target_id?: string;
  capability_id: string;
  canonical_name?: string;
  network?: { host?: string; port?: number } | null;
  health?: { path?: string } | null;
  authority?: string;
  evidence_refs?: readonly string[];
}
export interface ConnectionDeclarationRow {
  executor_capability_id?: string | null;
  endpoint?: string | null;
  protocol?: string | null;
  credential_ref?: { ref?: string } | null;
  execution_boundary?: string | null;
  target_resolution?: string;
}

export interface RouteStores {
  capabilities: readonly CapabilityRow[];
  resources: readonly ResourceRow[];
  resourceCapabilities: readonly ResourceCapabilityRow[];
  runtimeTargets: readonly RuntimeTargetRow[];
  connectionDeclarations: readonly ConnectionDeclarationRow[];
}

/**
 * Resolve หนึ่ง capability เป็นที่อยู่ที่เรียกได้ — pure และ total
 *
 * ลำดับตั้งใจ: ตัวตนก่อนเสมอ ถ้าไม่มีตัวตนก็ไม่มีอะไรให้ route ต่อให้บังเอิญมี
 * endpoint ที่ชื่อคล้ายกันอยู่ก็ตาม การยอม route ของที่ไม่มีตัวตนคือการปล่อยให้
 * ที่อยู่กลายเป็นตัวตน ซึ่งเป็นสิ่งที่ทะเบียน canonical มีไว้เพื่อป้องกัน
 */
export function resolveCapabilityRoute(
  query: string,
  stores: RouteStores,
  now: () => Date = () => new Date(),
): RouteResolution {
  const at = now().toISOString();
  const base = { query, resolved_at: at };
  let identity: CapabilityIdentity | null = null;
  const fail = (outcome: RouteOutcome, reason: string): RouteResolution =>
    ({ ...base, outcome, route: null, identity, reason });

  const cap = stores.capabilities.find(
    (c) => c.capability_id === query || c.canonical_name === query,
  );
  if (!cap) return fail("NO_CANONICAL_IDENTITY", `ไม่พบ capability ที่ตรงกับ "${query}" ในทะเบียน canonical`);

  const resourceIds = stores.resourceCapabilities
    .filter((rc) => rc.capability_id === cap.capability_id)
    .map((rc) => rc.resource_id);
  const source_pointer = stores.resources
    .filter((r) => resourceIds.includes(r.resource_id))
    .map((r) => r.source_location)
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  const targets = stores.runtimeTargets.filter((t) => t.capability_id === cap.capability_id);
  const latestTargets = [...targets.reduce((m, t, i) => {
    m.set(t.runtime_target_id ?? `row:${i}`, t);
    return m;
  }, new Map<string, RuntimeTargetRow>()).values()];
  identity = {
    capability_id: cap.capability_id, canonical_name: cap.canonical_name, source_pointer,
    has_runtime_pointer: latestTargets.length > 0,
  };
  const declarations = stores.connectionDeclarations.filter(
    (d) => d.executor_capability_id === cap.capability_id && typeof d.endpoint === "string" && d.endpoint.length > 0,
  );

  if (latestTargets.length + declarations.length === 0) {
    return fail("NO_RUNTIME_BINDING",
      `capability ${cap.canonical_name} มีตัวตนแต่ไม่มีใครประกาศว่ามันรันที่ไหน — ต้องมี RuntimeTarget หรือ ConnectionDeclaration ก่อนจึงจะเรียกได้`);
  }
  if (latestTargets.length + declarations.length > 1) {
    return fail("RUNTIME_BINDING_AMBIGUOUS",
      `capability ${cap.canonical_name} มีที่อยู่ที่ประกาศไว้ ${latestTargets.length + declarations.length} แห่ง — ไม่เลือกให้เอง`);
  }

  if (latestTargets.length === 1) {
    const t = latestTargets[0]!;
    const host = t.network?.host, port = t.network?.port;
    if (!host || !port) {
      return fail("NO_RUNTIME_BINDING",
        `RuntimeTarget ของ ${cap.canonical_name} ไม่มี host/port ที่ยิงได้ — ประกาศไว้แต่ไม่ครบ`);
    }
    return {
      ...base, outcome: "ROUTE_RESOLVED", reason: null, identity,
      route: {
        capability_id: cap.capability_id, canonical_name: cap.canonical_name, source_pointer,
        runtime_kind: "LOCAL_SERVICE", address: `http://${host}:${port}`, protocol: "HTTP",
        health_path: t.health?.path ?? null, credential_ref: null,
        authority: t.authority ?? "UNKNOWN", evidence_refs: t.evidence_refs ?? [],
        resolved_from: [
          "software/registry-database/data/canonical/capabilities.jsonl",
          "software/registry-database/data/canonical/resource_capabilities.jsonl",
          "control/machine-observation/data/runtime-targets.jsonl",
        ],
      },
    };
  }

  const d = declarations[0]!;
  return {
    ...base, outcome: "ROUTE_RESOLVED", reason: null, identity,
    route: {
      capability_id: cap.capability_id, canonical_name: cap.canonical_name,
      source_pointer: source_pointer.length > 0 ? source_pointer
        : (typeof d.execution_boundary === "string" ? [d.execution_boundary] : []),
      runtime_kind: "OUTBOUND_CONNECTION", address: d.endpoint!, protocol: d.protocol ?? "UNKNOWN",
      health_path: null,
      // ตัวชี้เท่านั้น — ค่าจริงอยู่ใน Keychain และไม่เคยผ่านชั้นนี้
      credential_ref: d.credential_ref?.ref ?? null,
      authority: d.target_resolution === "RESOLVED" ? "DECLARED_RESOLVED" : "DECLARED_UNRESOLVED",
      evidence_refs: [],
      resolved_from: [
        "software/registry-database/data/canonical/capabilities.jsonl",
        "connections/connection-registry/data/connection-declarations.jsonl",
      ],
    },
  };
}
