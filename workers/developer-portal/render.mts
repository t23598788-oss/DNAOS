import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createElement, Fragment, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import DevelopersPage, { metadata } from "../../app/developers/page";
import DeveloperTopicPage, { generateMetadata, generateStaticParams } from "../../app/developers/[...topic]/page";
import sitemap from "../../app/developers/sitemap";
import { GET } from "../../app/api/v1/spec/route";

const out = process.argv[2]!;
const stylesheet = join(process.cwd(), "workers/developer-portal/portal.css");
const css = await postcss([tailwindcss()]).process(
  '@import "tailwindcss" source(none); @source "../../app/developers";',
  { from: stylesheet },
);

async function write(path: string, value: string) {
  const file = join(out, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, value);
}

function makePage(meta: typeof metadata, content: string) {
  const tags = renderToStaticMarkup(createElement(Fragment, null,
    createElement("title", null, meta.title),
    createElement("meta", { name: "description", content: meta.description }),
    createElement("link", { rel: "canonical", href: meta.alternates.canonical }),
    createElement("link", { rel: "icon", href: meta.icons.icon.url, type: meta.icons.icon.type, sizes: meta.icons.icon.sizes }),
  ));
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${tags}<style>${css.css}</style></head><body>${content}</body></html>`;
}

await write("developers.html", makePage(metadata, renderToStaticMarkup(createElement(DevelopersPage as ComponentType))));
for (const params of generateStaticParams()) {
  const props = { params: Promise.resolve(params) };
  const page = await DeveloperTopicPage(props);
  const meta = await generateMetadata(props);
  await write(`developers/${params.topic.join("/")}.html`, makePage(meta, renderToStaticMarkup(page)));
}
const sitemapEntries = sitemap().map(({ url }) => `  <url><loc>${url}</loc></url>`);
await write("developers/sitemap.xml", [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...sitemapEntries,
  "</urlset>",
  "",
].join("\n"));

const brandPath = "developers/brand";
await mkdir(join(out, brandPath), { recursive: true });
for (const asset of ["dna-os-horizontal-mono.png", "dna-os-mark-mono.png"]) {
  await copyFile(join("public", brandPath, asset), join(out, brandPath, asset));
}
await copyFile("public/developers/scroll-nav.js", join(out, "developers/scroll-nav.js"));
const spec = await GET();
await write("api/v1/spec", await spec.text());
await write("_headers", "/api/v1/spec\n  Content-Type: application/json; charset=utf-8\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=300\n");
