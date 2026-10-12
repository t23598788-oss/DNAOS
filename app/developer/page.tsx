import Link from "next/link";
import AdminSidebarNav from "@/components/admin/AdminSidebarNav";
import { requireAuthPage } from "@/core/auth/requireAuthPage";
import { ADMIN_TIER } from "@/core/auth/session";

/**
 * /developer — DEVELOPER WORKSPACE (owner directive 2026-10-12).
 *
 * หน้าทางเข้าของสายพัฒนา: มีแค่เครื่องมือนักพัฒนา (IDE / Dev Loop / Deploy /
 * UI Gallery) — ไม่มีเครื่องมือธุรกิจและไม่มีเมนูธุรกิจปน ทุกลิงก์ชี้ไป
 * หน้าเดิมที่มีอยู่แล้ว ไม่มีหน้า/ระบบใหม่ถูกสร้างมาแทนของเดิม
 *
 * ตัวหน้าไม่ใช่ผู้ให้สิทธิ์: แต่ละ route ยังมี server guard ของตัวเอง
 * (requireAuthPage/requireAuth) และการแก้ source ยังต้องผ่าน security
 * gate เดิมทั้งหมด — ดู registry/permissions.json#capability_actions
 */

const DEV_NAV: { href: string; label: string; icon: string; group: string }[] = [
  { href: "/admin/ide", label: "Software Factory IDE", icon: "Cpu", group: "dev" },
  { href: "/admin/dev-loop", label: "Dev Loop (Workflow)", icon: "Network", group: "dev" },
  { href: "/admin/deploy", label: "Deploy (Source/Release)", icon: "Shield", group: "dev" },
  { href: "/admin/ui-gallery", label: "UI Gallery (Design Review)", icon: "Puzzle", group: "dev" },
];

const DEV_TOOLS: { href: string; title: string; description: string }[] = [
  {
    href: "/admin/ide",
    title: "Software Factory IDE",
    description:
      "Explorer / Editor / Source Control / Execution · Worker Selector และ Code Generation · file write, build, release ทั้งหมดเดินเข้า fsSecurity + review/build gate เดิม",
  },
  {
    href: "/admin/dev-loop",
    title: "Dev Loop — Development Workflow",
    description:
      "Pipeline ปัญหา/ข้อเสนอการพัฒนา และการอนุมัติ (approve) — สายธุรกิจไม่มีสิทธิ์เรียก /api/admin/dev-loop",
  },
  {
    href: "/admin/deploy",
    title: "Deploy — Source / Release",
    description:
      "ข้อมูล git + environment ของ deployment — การ execute deployment เป็น developer-plane action และยังต้องผ่าน scripts/deploy-gate.ts เดิม",
  },
  {
    href: "/admin/ui-gallery",
    title: "UI Gallery — Design Review",
    description:
      "คลังหน้าจอ/component สำหรับตรวจงานพัฒนา (local UI review เดิม) — ไม่ใช่หน้าทำงานธุรกิจ",
  },
];

export default async function DeveloperWorkspacePage() {
  const user = await requireAuthPage("/developer", ADMIN_TIER);

  return (
    <div className="flex h-full min-h-0 bg-stone-50">
      <AdminSidebarNav
        navItems={DEV_NAV}
        headerLabel="Developer Workspace"
        headerIcon="Cpu"
        userEmail={user.email}
      />
      <main className="flex-1 min-w-0 overflow-y-auto p-8">
        <h1 className="text-xl font-bold text-stone-800">Developer Workspace</h1>
        <p className="text-sm text-stone-500 mt-1">
          ระบบพัฒนา — แก้ไขไฟล์และ Source Code · Worker Selector และ Code Generation ·
          GitHub และ Development Workflow
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {DEV_TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="block bg-white border border-stone-200 rounded-xl p-4 hover:border-stone-400 transition-colors"
            >
              <div className="text-sm font-semibold text-stone-800">{tool.title}</div>
              <div className="text-[11px] text-stone-500 mt-1 leading-relaxed">{tool.description}</div>
              <div className="text-[11px] font-mono text-stone-400 mt-2">{tool.href}</div>
            </Link>
          ))}
        </div>

        <section className="mt-8 bg-white border border-stone-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-stone-800">สิทธิ์บนพื้นผิวนี้</h2>
          <ul className="text-[12px] text-stone-600 mt-2 space-y-1 leading-relaxed">
            <li>· Development surface — สั่ง source.modify / git.push / deployment.execute / developer.worker.execute ได้ และยังต้องผ่าน Authority เดิมทุกชั้น (requireAuth → fsSecurity → review/build → deploy-gate)</li>
            <li>· Business surface (/workspace) ถูก DENY ทั้งหมด — บังคับที่ middleware ทุกคำขอ API ไม่ใช่แค่ซ่อนปุ่ม</li>
            <li>· ไม่มี role ใหม่ ไม่มีสิทธิ์ใหม่ — Identity/Authority กลางเดิม (registry/permissions.json + core/auth) ยังเป็นผู้ตัดสินคนเดียว</li>
            <li>· Shared Capabilities (CLI/File reader · File conversion · Document scanner · AI Gateway · Browser/Computer use · Failure bridge · Checkpoint/Evidence · Connector lifecycle · Desktop/Tauri) ใช้งานจาก Business Workspace ได้ครบเหมือนเดิม</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
