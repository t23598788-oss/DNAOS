"use client"

import FinanceWorkspace from "@/components/finance/FinanceWorkspace"

// Finance admin (UNIFIED FINANCE ADMIN mission, 2026-10-11) — หน้าจอการเงิน
// รวมของ Admin (สร้าง/บันทึก/รายการ/เอกสาร/ประวัติ) — ทุกอย่างเข้าสู่
// canonical writers เดิม ไม่มีระบบ Manual แยก · เนื้อหาสรุปการเงินเดิม
// (owner 2026-07-25) ย้ายไป tab "ภาพรวม" ใน FinanceWorkspace โดยไม่เปลี่ยน
export default function FinancePage() {
  return <FinanceWorkspace />
}
