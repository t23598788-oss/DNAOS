import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const dist = "workers/developer-portal/dist";
const pages = new Map();
const canonicals = new Set();
const descriptions = new Set();
const fonts = await readFile(join(dist, "developers/fonts/dna-fonts.css"), "utf8");
for (const [, filename] of fonts.matchAll(/url\("\.\/([^"]+)"\)/g)) {
  assert.equal((await readFile(join(dist, "developers/fonts", filename))).subarray(0, 4).toString(), "wOF2");
}
assert.equal([...fonts.matchAll(/@font-face/g)].length, 3);

const iconPath = "/developers/brand/dna-os-mark-mono.png";
await readFile(join(dist, iconPath.slice(1)));
for (const file of await readdir(dist, { recursive: true })) {
  if (!file.endsWith(".html")) continue;
  const html = await readFile(join(dist, file), "utf8");
  pages.set("/" + file.slice(0, -5), html);
}
for (const [path, html] of pages) {
  assert(!html.includes("127.0.0.1:3183"), path);
  assert(html.includes('href="/developers/fonts/dna-fonts.css"'), path);
  const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  assert(description && !descriptions.has(description), path);
  assert(canonical && !canonicals.has(canonical), path);
  descriptions.add(description);
  canonicals.add(canonical);
  assert(html.includes(`<link rel="icon" href="${iconPath}"`), path);

  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert(ld, path);
  const graph = JSON.parse(ld)["@graph"];
  const [organization, website, page] = ["Organization", "WebSite", "WebPage"].map(
    (type) => graph.find((entry) => entry["@type"] === type),
  );
  const url = new URL(canonical);
  assert.equal(url.protocol, "https:", path);
  assert.equal(url.pathname, path);
  assert.equal(page.url, canonical, path);
  assert.equal(page["@id"], `${canonical}#webpage`, path);
  assert.equal(page.isPartOf["@id"], `${url.origin}/#website`, path);
  assert.equal(website["@id"], page.isPartOf["@id"], path);
  assert.equal(organization["@id"], `${url.origin}/#organization`, path);
  assert.equal(website.publisher["@id"], organization["@id"], path);
  assert.equal(page.publisher["@id"], organization["@id"], path);
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

const sitemap = await readFile(join(dist, "developers/sitemap.xml"), "utf8");
const listedUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert.equal(listedUrls.length, canonicals.size);
assert.deepEqual(new Set(listedUrls), canonicals);

const spec = JSON.parse(await readFile(join(dist, "api/v1/spec"), "utf8"));
const registry = JSON.parse(await readFile("registry/command-registry.json", "utf8"));
const expected = Object.entries(registry.commands)
  .filter(([id, command]) => !id.startsWith("_") && (command.status ?? "active") === "active" && !command.requires_confirmation)
  .map(([id]) => id);
assert(expected.length > 0);
assert.deepEqual(spec.tools.map((tool) => tool.function._dna_command), expected);
console.log(`Verified ${pages.size} pages and ${expected.length} API tools`);
