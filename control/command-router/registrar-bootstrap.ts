/**
 * ต่อสายรายการ capability ของเส้นทางคำสั่ง เข้าไปให้ตัวตัดสินสิทธิ์
 *
 * ทิศการพึ่งพาถูกกลับเมื่อ 2026-09-04 — capability-registrar ไม่ไปดึงเองแล้ว
 * DNA OS เป็นฝ่ายส่งเข้าไป ไฟล์นี้อยู่ฝั่ง DNA OS โดยตั้งใจ
 *
 * ส่งเป็น "ตัวดึงข้อมูล" ไม่ใช่ข้อมูลสำเร็จรูป เพราะการเรียก listCapabilities()
 * ตอนโหลดโมดูลทำให้เกิด module-load cycle จริง — พิสูจน์แล้วด้วย router.test.ts
 * ที่ล้มเหลวตอนลองแบบเรียกทันที
 */
import { listCapabilities } from "./contract";
import { setCapabilityRegistrationsProvider } from "../../software/capability-registrar/contract";

setCapabilityRegistrationsProvider(() =>
  listCapabilities().map((c) => ({
    capability_id: c.capability_id,
    repo_id: c.repo_id,
    contract: c.contract,
    endpoint: c.endpoint as { kind: string; module?: string; entry?: string; url?: string },
    supported_commands: c.supported_commands,
    permission_requirement: c.permission_requirement,
    health_status: c.health_status,
  })),
);
