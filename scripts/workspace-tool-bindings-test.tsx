import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { TOOLS } from "../app/workspace/_lib/businessTools";
import { TOOL_BINDINGS, SETTINGS_BOXES, orderGrantedTools } from "../app/workspace/_lib/toolBindings";

// ONE NAVIGATION (2026-10-06): BusinessWorkspace shell (IconRail + TabStrip +
// WorkspaceSettings + InboxIndicator) ถูกลบ — /workspace ใช้ WorkspaceFrame
// เป็น shell เดียว เทสต์นี้คงเฉพาะส่วน "ข้อมูล binding" ที่ยังเป็น source จริง
// (toolBindings.ts ยังถูก auth-access-test + provider-credentials-test อ่านอยู่)
// ไม่มีการ render shell ที่ไม่มีอยู่แล้ว

assert.deepEqual(Object.keys(TOOL_BINDINGS).sort(), TOOLS.map(t => t.key).sort());
assert.deepEqual(orderGrantedTools(TOOLS, ["people"], ["finance", "people", "people", "unknown"]).map(t => t.key), ["people"]);
assert.equal(orderGrantedTools(TOOLS, [], ["people"]).length, 0);
for (const binding of [...Object.values(TOOL_BINDINGS), ...SETTINGS_BOXES]) {
  if (!binding.route) continue;
  assert.match(binding.route, /^\/admin\/[a-z-]+$/);
  assert.ok(existsSync(`app${binding.route}/page.tsx`), `Missing route: ${binding.route}`);
}

// หน้าจอเดียว = WorkspaceFrame — shell เก่าต้องไม่กลับมาใน source
assert.ok(!existsSync("app/workspace/BusinessWorkspace.tsx"), "BusinessWorkspace must stay deleted (ONE NAVIGATION)");
assert.ok(!existsSync("app/workspace/_lib/workspaceAppearance.ts"), "workspaceAppearance must stay deleted (ONE NAVIGATION)");
assert.ok(existsSync("app/workspace/WorkspaceFrame.tsx"), "the shell page must render the WorkspaceFrame");

console.log("PASS: complete bindings, grant-only ordering, existing routes, ONE NAVIGATION (old shell stays deleted)");
