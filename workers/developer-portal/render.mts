import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import DevelopersPage, { metadata } from "../../app/developers/page";
import DeveloperTopicPage, { generateMetadata, generateStaticParams } from "../../app/developers/[...topic]/page";
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

function makePage(title: string, content: string) {
  const safeTitle = renderToStaticMarkup(createElement("title", null, title));
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${safeTitle}<style>${css.css}</style></head><body>${content}</body></html>`;
}

await write("developers.html", makePage(metadata.title, renderToStaticMarkup(createElement(DevelopersPage as ComponentType))));
for (const params of generateStaticParams()) {
  const props = { params: Promise.resolve(params) };
  const page = await DeveloperTopicPage(props);
  const meta = await generateMetadata(props);
  await write(`developers/${params.topic.join("/")}.html`, makePage(meta.title ?? "DNA OS", renderToStaticMarkup(page)));
}
const brandPath = "developers/brand";
await mkdir(join(out, brandPath), { recursive: true });
for (const asset of ["dna-os-horizontal-mono.png", "dna-os-mark-mono.png"]) {
  await copyFile(join("public", brandPath, asset), join(out, brandPath, asset));
}
const spec = await GET();
await write("api/v1/spec", await spec.text());
await write("_headers", "/api/v1/spec\n  Content-Type: application/json; charset=utf-8\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=300\n");
