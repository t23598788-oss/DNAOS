import { build } from "esbuild";
import { mkdtemp, rm, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = resolve("workers/developer-portal");
const temp = await mkdtemp(join(dir, ".build-"));
try {
  const bundle = join(temp, "render.mjs");
  await build({
    entryPoints: [join(dir, "render.mts")],
    outfile: bundle,
    platform: "node",
    jsx: "automatic",
    format: "esm",
    bundle: true,
    packages: "external",
    define: { "process.env.DNAOS_PUBLIC_DOCS_ONLY": '"1"' },
    plugins: [{
      name: "static-developer-portal",
      setup(compiler) {
        compiler.onResolve({ filter: /^next\/(link|navigation|server)$/ }, ({ path }) => ({ path: path + ".js", external: true }));
        compiler.onResolve({ filter: /^\.\/LegacyDocLinks$/ }, () => ({
          path: join(dir, "legacy-links.tsx"),
        }));
      },
    }],
  });
  process.argv[2] = join(temp, "dist");
  await import(pathToFileURL(bundle).href);
  await rm(join(dir, "dist"), { force: true, recursive: true });
  await rename(process.argv[2], join(dir, "dist"));
} finally {
  await rm(temp, { force: true, recursive: true });
}
