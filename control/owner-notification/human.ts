import type { HumanNotificationProjectionV1, OwnerNotificationV1 } from "./types";

const TITLES: Record<string, string> = {
  WORK_STARTED: "งานเริ่มแล้ว",
  WORK_PROGRESS: "งานกำลังดำเนิน",
  WORK_COMPLETED: "งานเสร็จตามวงจร DNA OS",
  WORK_ACCEPTED: "งานถูกรับแล้ว",
  REPORT_CREATED: "มีรายงานใหม่",
  CLIENT_DISCONNECTED: "ไคลเอนต์พัฒนาหลุดการเชื่อมต่อ",
  FILE_RECEIVED: "ได้รับไฟล์ที่ลงทะเบียน",
  STALE: "งานไม่มีความคืบหน้า",
  CODING_STARTED: "เริ่มงานพัฒนา",
  BUILD_COMPLETED: "build ผ่านแล้ว",
  BUILD_FAILED: "build ไม่ผ่าน",
  TEST_COMPLETED: "ทดสอบผ่านแล้ว",
  TEST_FAILED: "การทดสอบล้มเหลว",
  REVIEW_READY: "พร้อมให้เจ้าของตรวจ",
  OWNER_APPROVAL_REQUIRED: "ต้องการการอนุมัติของเจ้าของ",
  PUBLISH_STARTED: "เริ่มเผยแพร่ source",
  PUBLISHED: "เผยแพร่ source แล้ว",
  DEPLOYMENT_STARTED: "เริ่มส่งขึ้น runtime",
  DEPLOYED: "ส่ง revision ขึ้น runtime แล้ว กำลังตรวจสอบ",
  DEPLOYMENT_FAILED: "ส่งขึ้น runtime ไม่สำเร็จ",
  RUNTIME_VERIFIED: "อัปเดตระบบสำเร็จ",
  RUNTIME_VERIFICATION_FAILED: "ตรวจ runtime ไม่ผ่าน",
  CAPABILITY_REGISTERED: "ความสามารถถูกสร้างแล้ว",
  CAPABILITY_AVAILABLE: "ความสามารถพร้อมใช้งานแล้ว",
  CAPABILITY_DISABLED: "ความสามารถถูกปิดใช้งาน",
  ROLLBACK_STARTED: "เริ่ม rollback",
  ROLLBACK_COMPLETED: "rollback เสร็จแล้ว",
  ROLLBACK_FAILED: "rollback ล้มเหลว",
  CONNECTION_CHANGED: "connection เปลี่ยนสถานะ",
  RESOURCE_CHANGED: "ทรัพยากรเปลี่ยนสถานะ",
  INBOUND_MESSAGE: "มีข้อความเข้า",
  INBOUND_EMAIL: "มีอีเมลเข้า",
  INBOUND_SYSTEM_EVENT: "มีเหตุการณ์ระบบเข้า",
  WORK_CHECKPOINT_COMPLETED: "ขั้นงานคืบหน้า",
  WORK_CHECKPOINT_FAILED: "ขั้นงานล้มเหลว",
  WORK_WAITING_FOR_OWNER: "ต้องการการอนุมัติจาก Owner",
  WORK_COMPLETION_REPORT_READY: "รายงานงานพร้อมแล้ว",
  WORK_FULLY_COMPLETED: "งานเสร็จสมบูรณ์",
  UNREGISTERED_AGENT_ACTIVITY: "พบกิจกรรมของ coding client ที่ยังไม่ถูกผูกกับงาน DNA OS",
  SYSTEM_WARNING: "คำเตือนระบบ",
  SYSTEM_ERROR: "ข้อผิดพลาดระบบ",
  SECURITY_SENSITIVE_REAUTH: "ต้องการยืนยันตัวตนใหม่",
  DEVELOPMENT_PROPOSAL_READY: "ข้อเสนอพัฒนาพร้อมแล้ว",
};

function revisionOf(row: OwnerNotificationV1): string {
  const value = row.structured_facts.revision;
  return value === undefined || value === null ? "" : String(value);
}

export function projectHumanNotification(row: OwnerNotificationV1): HumanNotificationProjectionV1 {
  const revision = revisionOf(row);
  let title = TITLES[row.notification_type] ?? row.title_key;
  let message = `${row.notification_type}`;
  if (row.source_system === "github-branch-governance" || row.source_system === "diverged-source-integration") {
    const subject = String(row.structured_facts.subject ?? title);
    title = subject;
    message = subject;
  } else if (row.notification_type === "PUBLISHED") {
    message = revision ? `เผยแพร่ source revision ${revision} แล้ว` : "เผยแพร่ source แล้ว";
  } else if (row.notification_type === "DEPLOYED") {
    message = revision ? `ส่ง revision ${revision} ขึ้น runtime แล้ว กำลังตรวจสอบ` : "อัปเดตขึ้น production แล้ว กำลังตรวจ runtime";
  } else if (row.notification_type === "RUNTIME_VERIFIED") {
    title = "runtime ตรวจสอบสำเร็จ";
    message = revision
      ? `revision ${revision} ทำงานอยู่และผ่านการตรวจ runtime แล้ว`
      : "runtime ตรวจสอบสำเร็จ";
  } else if (row.notification_type === "CAPABILITY_REGISTERED") {
    message = row.structured_facts.owner_enabled === true
      ? "ความสามารถถูกสร้างแล้ว"
      : "ความสามารถถูกสร้างและตรวจสอบแล้ว แต่ยังไม่ได้เปิดใช้งาน";
  } else if (row.notification_type === "CAPABILITY_AVAILABLE") {
    message = "ความสามารถใหม่พร้อมใช้งานแล้ว";
  } else if (row.notification_type === "WORK_ACCEPTED" || row.notification_type === "CODING_STARTED") {
    const client = String(row.structured_facts.client ?? row.source_system);
    const subject = String(row.structured_facts.subject ?? row.work_id ?? "");
    title = `${client} เริ่มทำงาน`;
    message = `${client} เริ่มทำงาน: ${subject}`;
  } else if (row.notification_type === "TESTING") {
    message = `กำลังทดสอบงาน ${row.work_id ?? ""}`.trim();
  } else if (row.notification_type === "WORK_COMPLETED") {
    const reports = Number(row.structured_facts.reports_created ?? 0);
    title = "งานเสร็จแล้ว";
    message = `งานเสร็จแล้ว: สร้างรายงาน ${reports} รายการ`;
  } else if (row.notification_type === "REVIEW_READY") {
    title = "งานพร้อมตรวจสอบ";
    message = "งานพร้อมตรวจสอบ";
  } else if (row.notification_type === "TEST_FAILED") {
    message = "การทดสอบไม่ผ่าน — ต้องตรวจสอบ";
  } else if (row.notification_type === "OWNER_APPROVAL_REQUIRED" || row.notification_type === "WORK_WAITING_FOR_OWNER") {
    title = "ต้องการการอนุมัติจาก Owner";
    message = "ต้องการการอนุมัติจาก Owner";
  } else if (row.notification_type === "WORK_FULLY_COMPLETED") {
    const reports = Number(row.structured_facts.reports_created ?? 0);
    title = "งานเสร็จสมบูรณ์";
    message = `งานเสร็จสมบูรณ์ — สร้างรายงาน ${reports} รายการ`;
  } else if (row.notification_type === "WORK_COMPLETION_REPORT_READY") {
    const reports = Number(row.structured_facts.reports_created ?? 0);
    message = `งานเสร็จสมบูรณ์ — สร้างรายงาน ${reports} รายการ`;
  } else if (row.notification_type === "WORK_CHECKPOINT_FAILED") {
    const step = String(row.structured_facts.checkpoint ?? row.state_after ?? "");
    title = "งานหยุด";
    message = `งานหยุดที่ขั้น ${step}`;
  } else if (row.notification_type === "UNREGISTERED_AGENT_ACTIVITY") {
    title = "พบกิจกรรมที่ยังไม่ถูกผูก";
    message = "พบกิจกรรมของ coding client ที่ยังไม่ถูกผูกกับงาน DNA OS";
  } else if (row.notification_type === "WORK_CHECKPOINT_COMPLETED") {
    const kind = String(row.structured_facts.catchup_kind ?? "");
    const checkpoint = String(row.structured_facts.checkpoint ?? "");
    const subject = String(row.structured_facts.subject ?? row.work_id ?? "");
    const reports = Number(row.structured_facts.reports_created ?? 0);
    if (kind === "READY_ADMISSION") {
      title = "พร้อมรับเข้า canonical";
      message = `งาน ${subject} พร้อมรับเข้า canonical`;
    } else if (kind === "WAIT_INTEGRATION" || checkpoint === "INTEGRATED") {
      message = kind === "WAIT_INTEGRATION" ? `งาน ${subject} รอรับเข้า canonical` : "รับ source เข้า canonical แล้ว";
    } else if (kind === "NO_REMOTE_DEPLOY") {
      title = "ยังไม่ได้ deploy";
      message = `งาน ${subject} ยังไม่ได้ deploy เพราะ REMOTE_REAL ไม่ได้เชื่อม`;
    } else if (kind === "BLOCKED_RUNTIME") {
      title = "งานถูกบล็อก";
      message = `งาน ${subject} ถูกบล็อกที่ runtime verification`;
    } else if (kind === "STALE") {
      title = "งานประวัติ";
      message = `งาน ${subject} เป็นงานประวัติที่ไม่ active`;
    } else if (kind === "REMOTE_FOUND_REGISTERED") {
      title = "พบ production เดิม";
      message = "พบ production เดิมและลงทะเบียนแล้ว";
    } else if (kind === "REMOTE_TARGET_BOUND") {
      title = "เชื่อม deployment target";
      message = "เชื่อม deployment target เดิมสำเร็จ";
    } else if (kind === "REMOTE_DEPLOY_AUTH_MISSING") {
      title = "ยังขาดสิทธิ์ deploy";
      message = "พบ production เดิม แต่ยังขาดสิทธิ์ deploy";
    } else if (kind === "DEPLOYING_REVISION") {
      title = "กำลัง deploy";
      message = revision ? `กำลัง deploy revision ${revision}` : "กำลัง deploy";
    } else if (kind === "DEPLOY_RUNTIME_CHECK") {
      title = "กำลังตรวจ runtime";
      message = "deploy เสร็จ กำลังตรวจ runtime";
    } else if (kind === "RUNTIME_REVISION_OK") {
      title = "runtime ตรวจสอบสำเร็จ";
      message = revision ? `runtime revision ${revision} ตรวจสอบสำเร็จ` : "runtime ตรวจสอบสำเร็จ";
    } else if (kind === "PRODUCTION_NOT_CLOSED") {
      title = "ยังไม่สามารถปิด production ได้";
      message = `ยังไม่สามารถปิด production ได้: ${String(row.structured_facts.blocking ?? row.structured_facts.subject ?? "")}`;
    } else if (kind === "TARGET_READY_TO_ENABLE") {
      title = "production target พร้อมเปิดใช้งาน";
      message = "production target พร้อมเปิดใช้งาน";
    } else if (kind === "OWNER_ENABLED_TARGET") {
      title = "Owner เปิด Railway production target แล้ว";
      message = "Owner เปิด Railway production target แล้ว";
    } else if (kind === "DEPLOY_STARTED") {
      title = "เริ่ม deploy";
      message = revision ? `เริ่ม deploy revision ${revision}` : "เริ่ม deploy";
    } else if (kind === "DEPLOY_ACCEPTED") {
      title = "Railway รับ deployment แล้ว";
      message = "Railway รับ deployment แล้ว";
    } else if (kind === "DEPLOY_RUNTIME_CHECK") {
      title = "กำลังตรวจ runtime";
      message = "deployment สำเร็จ กำลังตรวจ runtime";
    } else if (kind === "LINEAGE_ALIGNED") {
      title = "production lineage ตรงกันแล้ว";
      message = "production lineage ตรงกันแล้ว";
    } else if (kind === "OWNER_ENABLE_REQUIRED") {
      title = "ต้องการการอนุมัติจาก Owner";
      message = "พบ production เดิม แต่ยังขาดสิทธิ์ deploy";
    } else if (kind === "PUBLISHED") {
      message = `งาน ${subject} เผยแพร่ remote แล้ว`;
    } else if (kind === "WAIT_PUBLISH") {
      title = "รอ publish";
      message = `งาน ${subject} รอ publish`;
    } else if (kind === "WAIT_DEPLOY") {
      title = "รอ deploy";
      message = `งาน ${subject} รอ deploy`;
    } else if (kind === "WAIT_RUNTIME") {
      title = "รอตรวจ runtime";
      message = `งาน ${subject} deploy แล้วแต่ยังไม่ตรวจ runtime`;
    } else if (kind === "VERIFIED" || checkpoint === "TEST_VERIFIED" || checkpoint === "BUILD_VERIFIED") {
      title = "ตรวจแล้ว";
      message = kind === "VERIFIED" ? `งาน ${subject} ตรวจเสร็จแล้ว` : "ตรวจ build/test ผ่านแล้ว";
    } else if (kind === "REPORTS") {
      message = `งาน ${subject} มีรายงาน ${reports} รายการ`;
    } else if (checkpoint === "IMPLEMENTING" || checkpoint === "ADMITTED") {
      message = kind === "WAIT_INTEGRATION" ? `งาน ${subject} รอรับเข้า canonical` : "งานเขียนโค้ดเสร็จแล้ว กำลังตรวจรับ";
    } else if (checkpoint === "INTEGRATED" || kind === "WAIT_CANONICAL") {
      message = kind === "WAIT_CANONICAL" ? `งาน ${subject} รอ canonical commit` : `งาน ${subject} รับเข้า canonical แล้ว`;
    } else {
      message = `งาน ${subject} ที่ขั้น ${checkpoint || row.state_after || ""}`.trim();
    }
  } else if (row.work_id) {
    message = `${row.notification_type} work=${row.work_id}`;
  }
  if (row.notification_type === "PUBLISHED" && /runtime verified|deployed|พร้อมใช้/.test(message)) {
    message = "เผยแพร่ source แล้ว";
  }
  return {
    schema: "HUMAN_NOTIFICATION_PROJECTION_V1",
    notification_id: row.notification_id,
    title,
    message,
    severity: row.severity,
    time: row.created_at,
    source_label: row.source_system,
    action_required: row.action_required,
    human_actions: row.owner_action_refs,
    technical_detail_ref: row.event_id,
    HUMAN_NOTIFICATION_REQUIRES_AI: false,
  };
}

export function successTruthLocks(): Record<string, boolean> {
  return {
    HUMAN_NOTIFICATION_REQUIRES_AI: false,
    NOTIFICATION_SOURCE_SEARCH_REQUIRED: false,
    PUBLISHED_EQUALS_DEPLOYED: false,
    DEPLOYED_EQUALS_RUNTIME_VERIFIED: false,
    CAPABILITY_REGISTERED_EQUALS_AVAILABLE: false,
    ARBITRARY_APPLESCRIPT: false,
    ARBITRARY_UI_AUTOMATION: false,
    NEW_NOTIFICATION_PERMISSION_AUTO_REQUESTED: false,
  };
}
