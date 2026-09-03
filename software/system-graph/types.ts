/**
 * หน้าที่: the shape of the REAL software circuit — nodes and edges that a
 * viewer may draw, and the evidence that entitles each one to exist.
 *
 * THE ONE RULE THIS FILE ENCODES: every edge carries `evidence_ref`, and it
 * is not optional. An edge with no evidence cannot be constructed, which is
 * how "NO EVIDENCE = NO EDGE" becomes a type error rather than a promise.
 *
 * Input: none (pure types).
 * Output: every type below.
 * Dependency ที่อนุญาต: none.
 * สิ่งที่ห้ามแตะ: never add an optional evidence field, and never add a
 * status value that means "probably fine". UNKNOWN is a real state and must
 * survive all the way to the screen.
 */

export type GraphNodeType =
  | "CAPABILITY"
  | "SERVICE"
  | "PROVIDER"
  | "DOMAIN";

/** How a component is currently running, as OBSERVED. Never inferred from code existing. */
export type NodeRuntimeStatus =
  | "RUNNING"
  | "NOT_RUNNING"
  | "HEALTHY"
  | "UNHEALTHY"
  | "UNKNOWN";

/** Only relationships something actually proved. No "related to". */
export type ConnectionType =
  | "DEPENDENCY"
  | "RUNTIME_CALL"
  | "MODULE_TO_CAPABILITY"
  | "ORCHESTRATES"
  | "CREDENTIAL_REFERENCE"
  | "RUNTIME_EXECUTION"
  | "CONTAINS";

/**
 * Whether the connection is carrying anything RIGHT NOW.
 * ACTIVE requires runtime evidence inside the activity window — a declared
 * dependency that nothing has exercised is INACTIVE, not active.
 */
export type EdgeRuntimeStatus = "ACTIVE" | "INACTIVE" | "BROKEN" | "UNKNOWN";

/** Structural confidence, taken verbatim from `../live-census/#deriveEdges`. */
export type EdgeState =
  | "CONNECTED_VERIFIED"
  | "CONNECTED_UNVERIFIED"
  | "DECLARED_ONLY"
  | "BROKEN"
  | "OBSERVED_RUNTIME"
  | "UNKNOWN";

/**
 * ทำไมค่าที่ยังไม่มีถึงต้องเป็น token ไม่ใช่ null เปล่า ๆ
 *
 * "ไม่มีข้อมูล" มีได้หลายความหมายที่นำไปสู่การกระทำคนละอย่าง: ยังไม่ได้ลงทะเบียน
 * (ต้องไปลงทะเบียน) ต่างจาก ลงทะเบียนแล้วแต่ไม่ได้ประกาศสัญญา (ต้องไปเติมสัญญา)
 * ต่างจาก ของชนิดนี้ไม่มีสิ่งนั้นโดยธรรมชาติ (ไม่ต้องทำอะไร) ถ้ายุบทั้งสามเป็น
 * null หน้าจอจะบอกได้แค่ "ว่าง" ซึ่งอ่านแล้วทำอะไรต่อไม่ได้เลย
 */
export type UndeclaredReason =
  /** capability นี้ไม่มีแถวใน Persistent Registry จึงไม่มีใครประกาศ role/input/output ไว้ */
  | "NOT_REGISTERED"
  /** ลงทะเบียนแล้ว แต่แถวนั้นเว้นฟิลด์นี้ไว้ */
  | "NOT_DECLARED"
  /** ไม่มี producer ไหนวัดสิ่งนี้ */
  | "NOT_MEASURED"
  /** node ชนิดนี้ไม่มีสิ่งนั้นโดยธรรมชาติ เช่น DOMAIN ไม่ใช่ของที่รันได้ */
  | "NOT_APPLICABLE";

/** ค่าที่อาจยังไม่มี — ถ้าไม่มีต้องบอกให้ได้ว่า "ไม่มีเพราะอะไร" */
export interface Declared<T> {
  readonly value: T | null;
  readonly undeclared_reason: UndeclaredReason | null;
  /** producer ที่ให้ค่านี้มา เพื่อให้คนกลับไปตรวจต้นทางได้ */
  readonly source: string;
}

/** ช่องทางที่ของจริงเข้า-ออก node นี้ — คนละเรื่องกับ "โค้ดอยู่ไฟล์ไหน" */
export type InterfaceKind =
  | "SOURCE_ENTRYPOINT"
  | "HTTP_PORT"
  | "LAUNCHD_JOB"
  | "CREDENTIAL_SCOPE"
  | "NOT_DECLARED";

/**
 * ตัวตนของ External Provider — ต้องแยกออกจาก capability ภายในของ DNA OS
 * อย่างชัดเจน เพราะสองอย่างนี้มีสิ่งที่เรารู้ต่างกันคนละชุด: ของภายในเรารู้
 * ซอร์ส เจ้าของ และสัญญา ของภายนอกเรารู้แค่ว่าเราถือกุญแจอะไรไว้คุยกับมัน
 * และไม่มีทางรู้ว่าข้างในมันทำอะไร การวาดสองอย่างนี้เหมือนกันคือการอ้างว่า
 * เรามองเห็นข้างในระบบของคนอื่น
 */
export interface ProviderIdentity {
  readonly provider_key: string;
  readonly display_name: string;
  /** บัญชี/องค์กรที่เราถือกุญแจของมัน ตามที่ credential registry บันทึกไว้ */
  readonly account: string | null;
  readonly credential_ref: string | null;
  readonly credential_status: string;
  /** ของนอกขอบเขต DNA OS เสมอ — ประกาศไว้เป็นค่าคงที่ ไม่ใช่คำนวณ */
  readonly outside_dna_os: true;
}

/**
 * เจ็ดข้อที่ทุก node ในวงจรปฏิบัติการต้องตอบให้ได้
 * ทุกข้อ join มาจาก producer ที่บันทึกไว้จริง ห้ามเติมจากการอนุมาน
 */
export interface NodeOperations {
  /** ทำหน้าที่อะไร */
  readonly role: Declared<string>;
  /** รับอะไรเข้า */
  readonly inputs: Declared<readonly string[]>;
  /** ส่งอะไรออก */
  readonly outputs: Declared<readonly string[]>;
  /** ผ่าน contract/API ใด */
  readonly interface_ref: Declared<string>;
  readonly interface_kind: InterfaceKind;
  /** สร้างหลักฐานอะไรกลับมา — side effect ที่เขียนของจริงลงที่ไหนสักแห่ง */
  readonly produces_evidence: Declared<readonly string[]>;
  /** ใครเป็นเจ้าของ */
  readonly owner: Declared<string>;
  /** อยู่ใน registry ไหม — ตัวชี้ว่าทำไม role/inputs/outputs ถึงว่าง */
  readonly registration_state: "REGISTERED" | "NOT_REGISTERED" | "NOT_APPLICABLE";
}

export interface GraphNode {
  readonly id: string;
  readonly name: string;
  readonly type: GraphNodeType;
  /** Which boundary owns it — repo/runtime owner, or the security boundary it sits behind. */
  readonly boundary: string;
  readonly source_path: string | null;
  readonly runtime_owner: string | null;
  readonly runtime_status: NodeRuntimeStatus;
  /** Verification state from the census. Distinct from runtime: code can be VERIFIED and not running. */
  readonly verification_status: string;
  readonly capability_id: string | null;
  readonly service_id: string | null;
  readonly domain: string | null;
  /** For progressive expansion: the node this one lives inside, when a real boundary says so. */
  readonly parent_id: string | null;
  readonly evidence_refs: readonly string[];
  /** Which producer this node came from — so a reader can go re-check it. */
  readonly source: string;
  /** เจ็ดข้อของวงจรปฏิบัติการ join จาก producer จริงเท่านั้น */
  readonly operations: NodeOperations;
  /** มีค่าเฉพาะ node ชนิด PROVIDER — null แปลว่าเป็นของภายใน DNA OS */
  readonly provider_identity: ProviderIdentity | null;
}

/**
 * เส้นในวงจรนี้ไม่ได้แปลว่าอย่างเดียวกันทั้งหมด — และนั่นคือเหตุผลที่ต้องแยก
 *
 * CONTAINMENT คือการจัดหมวดหมู่ (domain มี capability นี้อยู่ข้างใน) ไม่มีอะไร
 * ไหลผ่านมันเลย ส่วน DATA_FLOW คือของจริงที่วิ่ง การวาดสองอย่างนี้เป็นเส้นแบบ
 * เดียวกันทำให้แผนภาพอ่านว่า "มีการไหล 477 เส้น" ทั้งที่ 142 เส้นในนั้นเป็น
 * ป้ายหมวดหมู่ ไม่ใช่การไหล
 */
export type FlowKind =
  /** ของจริงวิ่งผ่านเส้นนี้ และมี producer สังเกตเห็น */
  | "DATA_FLOW"
  /** ประกาศว่าพึ่งพากันในโค้ด ยังไม่มีใครเห็นของวิ่งจริง */
  | "DECLARED_IMPORT"
  /** ความเป็นเจ้าของ/การจัดหมวด ไม่มีอะไรไหล */
  | "CONTAINMENT"
  /** launchd สั่งรันโปรเซส */
  | "PROCESS_EXECUTION";

export interface GraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly connection_type: ConnectionType;
  readonly direction: "OUT";
  /** The contract, API, or event that carries it. UNKNOWN when the producer does not record one. */
  readonly contract: string;
  readonly state: EdgeState;
  readonly runtime_status: EdgeRuntimeStatus;
  /** REQUIRED. An edge that cannot name its evidence must not be built. */
  readonly evidence_ref: string;
  readonly reason: string;
  readonly source: string;
  /** Only set for runtime edges: how many real calls were observed, and when the last one was. */
  readonly observed_calls?: number;
  readonly last_observed_at?: string;
  /** เส้นนี้แปลว่าอะไร — การไหล การประกาศ การจัดหมวด หรือการสั่งรัน */
  readonly flow_kind: FlowKind;
  /**
   * ข้อมูลอะไรวิ่งผ่านเส้นนี้ ตามที่ producer บันทึกไว้จริง
   * NOT_OBSERVED เมื่อยังไม่มีใครเห็นของวิ่ง — ห้ามเดาจากชื่อ capability
   */
  readonly payload_semantic: Declared<readonly string[]>;
}

export interface SystemGraph {
  readonly generated_at: string;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  /** Where every part came from, and how fresh it is. A viewer must be able to say "as of when". */
  readonly sources: readonly { readonly id: string; readonly detail: string; readonly as_of: string | null; readonly available: boolean }[];
  readonly counts: {
    readonly nodes_by_type: Readonly<Record<string, number>>;
    readonly edges_by_type: Readonly<Record<string, number>>;
    readonly edges_by_runtime_status: Readonly<Record<string, number>>;
    readonly nodes_without_edges: number;
    /** เส้นแยกตามความหมาย — การไหลจริงมีกี่เส้น ป้ายหมวดหมู่มีกี่เส้น */
    readonly edges_by_flow_kind: Readonly<Record<string, number>>;
    /** ตอบได้กี่ node ต่อคำถาม จากที่ถามได้ทั้งหมดกี่ node — ช่องว่างเป็นตัวเลข ไม่ใช่ความรู้สึก */
    readonly operational_facts_declared: Readonly<Record<string, number>>;
    readonly operational_facts_applicable: Readonly<Record<string, number>>;
  };
  /** Named, not hidden: what this graph could not resolve. */
  readonly unresolved: readonly string[];
}
