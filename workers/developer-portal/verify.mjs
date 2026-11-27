import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const dist = "workers/developer-portal/dist";
const pages = new Map();
for (const file of await readdir(dist, { recursive: true })) {
  if (!file.endsWith(".html")) continue;
  const html = await readFile(join(dist, file), "utf8");
  pages.set("/" + file.slice(0, -5), html);
}
for (const [path, html] of pages) {
  assert(!html.includes("127.0.0.1:3183"), path);
  for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    if (!href.startsWith("/") && !href.startsWith("#")) continue;
    const [link, anchor] = href.split("#");
    const target = link || path;
    assert(target === "/" || target === "/api/v1/spec" || pages.has(target), href);
    if (anchor) assert(pages.get(target)?.includes(`id="${anchor}"`), href);
  }
}
assert(pages.get("/developers/integrations/line")?.includes('id="service-line"'));
assert(pages.get("/developers")?.includes('"/developers/integrations/line#service-line"'));

const spec = JSON.parse(await readFile(join(dist, "api/v1/spec"), "utf8"));
const registry = JSON.parse(await readFile("registry/command-registry.json", "utf8"));
const expected = Object.entries(registry.commands)
  .filter(([id, command]) => !id.startsWith("_") && (command.status ?? "active") === "active" && !command.requires_confirmation)
  .map(([id]) => id);
assert(expected.length > 0);
assert.deepEqual(spec.tools.map((tool) => tool.function._dna_command), expected);
console.log(`Verified ${pages.size} pages and ${expected.length} API tools`);
