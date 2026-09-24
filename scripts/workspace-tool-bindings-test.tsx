import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { BusinessWorkspace } from "../app/workspace/BusinessWorkspace";
import { TOOLS } from "../app/workspace/_lib/businessTools";
import { TOOL_BINDINGS, SETTINGS_BOXES, orderGrantedTools } from "../app/workspace/_lib/toolBindings";
import { WORKSPACE_APPEARANCE } from "../app/workspace/_lib/workspaceAppearance";

assert.deepEqual(Object.keys(TOOL_BINDINGS).sort(), TOOLS.map(t => t.key).sort());
assert.deepEqual(orderGrantedTools(TOOLS, ["people"], ["finance", "people", "people", "unknown"]).map(t => t.key), ["people"]);
assert.equal(orderGrantedTools(TOOLS, [], ["people"]).length, 0);
for (const binding of [...Object.values(TOOL_BINDINGS), ...SETTINGS_BOXES]) {
  if (!binding.route) continue;
  assert.match(binding.route, /^\/admin\/[a-z-]+$/);
  assert.ok(existsSync(`app${binding.route}/page.tsx`), `Missing route: ${binding.route}`);
}
const appearance = { ...WORKSPACE_APPEARANCE, panelInitiallyClosed: false };
const pending = renderToStaticMarkup(<BusinessWorkspace allowedTools={["search"]} appearance={appearance} />);
assert.ok(pending.includes("ยังไม่ได้เชื่อมการค้นหารวม"));
assert.ok(!pending.includes("ผลลัพธ์ตัวอย่าง"));
const denied = renderToStaticMarkup(<BusinessWorkspace allowedTools={[]} appearance={appearance} />);
assert.ok(!denied.includes('aria-label="Settings"'));
assert.ok(!denied.includes('href="/admin/'));
const real = renderToStaticMarkup(<BusinessWorkspace allowedTools={["people"]} appearance={appearance} liveModels={{people: {id:"test", title:"Real partner list", domain:"test", blocks:[]}}} />);
assert.ok(!real.includes("ยังไม่ได้รับข้อมูลคู่ค้า"));
const routed = renderToStaticMarkup(<BusinessWorkspace allowedTools={["documents"]} appearance={appearance} />);
assert.ok(routed.includes('href="/admin/create-document"'));
assert.ok(!routed.includes("ใบแจ้งหนี้ (ตัวอย่าง)"));
console.log("PASS: complete bindings, layout cannot grant access, existing routes, no sample fallback, live model and route dispatch");
