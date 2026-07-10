import { requireAuthPage } from "@/core/auth/requireAuthPage"
import { SUPER_ADMIN_ONLY } from "@/core/auth/session"
import UsersRoleTable from "@/components/admin/UsersRoleTable"

// TASK-001: role assignment UI — restricted to super_admin even though
// app/admin/layout.tsx already lets admin/employee reach /admin/* pages in
// general (registry/permissions.json → api_access["/api/admin/users"]).
export default async function AdminUsersPage() {
  await requireAuthPage("/admin/users", SUPER_ADMIN_ONLY)

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-xl font-bold text-stone-900 mb-1">Users & Roles</h1>
      <p className="text-sm text-stone-500 mb-6">
        TASK-001 Permission Registry — กำหนด role ให้แต่ละบัญชี (super_admin เท่านั้น)
      </p>
      <UsersRoleTable />
    </div>
  )
}