/**
 * workspace-path-security-test.ts — runtime regression for the shared
 * source-path resolver (app/api/admin/ide/_lib/fsSecurity.ts) that every
 * remaining file/tree reader and writer goes through.
 *
 * Uses a SYNTHETIC fixture tree in a temp directory (fake secrets only, no
 * production data, no network). WORKSPACE_ROOT is captured at module load,
 * so the fixture is created and the cwd switched BEFORE the module is
 * imported. PASS/FAIL per check; exit 1 on any FAIL.
 *
 * Authorization (who may call the resolver at all) is covered separately by
 * scripts/auth-access-test.ts (requirePlatformOperator on every route).
 */
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---- synthetic fixture -------------------------------------------------------
const base = realpathSync(mkdtempSync(join(tmpdir(), "dna-path-sec-")));
const root = join(base, "workspace");
const outside = join(base, "outside");
mkdirSync(join(root, "src"), { recursive: true });
mkdirSync(join(root, "node_modules"), { recursive: true });
mkdirSync(outside, { recursive: true });
writeFileSync(join(root, "src", "ok.ts"), "export const ok = 1;\n");
writeFileSync(join(root, ".env.local"), "FAKE_SECRET=synthetic-not-real\n");
writeFileSync(join(root, "src", ".env"), "FAKE_SECRET=synthetic-not-real\n");
writeFileSync(join(root, "src", "secret-notes.txt"), "synthetic\n");
writeFileSync(join(root, "node_modules", "x.js"), "module.exports = 1;\n");
writeFileSync(join(outside, "secret.txt"), "OUTSIDE-SYNTHETIC\n");
symlinkSync(outside, join(root, "src", "escape"));
symlinkSync(join(outside, "secret.txt"), join(root, "src", "escape.txt"));
symlinkSync(join(root, "src", "ok.ts"), join(root, "src", "inside-link"));

// Switch cwd so WORKSPACE_ROOT (= process.cwd() at import) is the fixture.
process.chdir(root);

async function main(): Promise<void> {
  const { resolveSafeRelativePath, IdeFsError } = await import(
    "../app/api/admin/ide/_lib/fsSecurity"
  );

  async function expectReject(input: string, code: string, name: string): Promise<void> {
    try {
      const r = await resolveSafeRelativePath(input);
      check(name, false, `resolved to ${r.relPath} instead of ${code}`);
    } catch (e) {
      const got = e instanceof IdeFsError ? e.code : "NON_IDE_ERROR";
      check(name, got === code, `got ${got}`);
    }
  }

  console.log("\n== Allowed ==");
  try {
    const r = await resolveSafeRelativePath("src/ok.ts");
    check("plain in-tree file resolves", r.relPath === "src/ok.ts", r.relPath);
  } catch (e) {
    check("plain in-tree file resolves", false, String(e));
  }
  try {
    const r = await resolveSafeRelativePath("src/inside-link");
    check("symlink that stays inside the root is allowed", r.relPath === "src/inside-link");
  } catch (e) {
    check("symlink that stays inside the root is allowed", false, String(e));
  }

  console.log("\n== Path traversal ==");
  await expectReject("../outside/secret.txt", "PATH_OUTSIDE_WORKSPACE", "parent traversal ../ is refused");
  await expectReject("src/../../outside/secret.txt", "PATH_OUTSIDE_WORKSPACE", "nested traversal is refused");
  await expectReject("/etc/passwd", "INVALID_PATH", "absolute path is refused");
  await expectReject("src/ok.ts\0.txt", "INVALID_PATH", "null byte is refused");

  console.log("\n== Encoded traversal ==");
  // Percent-encoding is NOT decoded by the resolver, so %2e%2e is a literal
  // name inside the root. It must not escape; it simply does not exist.
  await expectReject("%2e%2e/outside/secret.txt", "NOT_FOUND", "percent-encoded ../ stays literal (no escape)");

  console.log("\n== Symlink escape ==");
  await expectReject("src/escape/secret.txt", "ACCESS_DENIED", "directory symlink to outside is refused");
  await expectReject("src/escape.txt", "ACCESS_DENIED", "file symlink to outside is refused");

  console.log("\n== Hidden environment / secret files ==");
  await expectReject(".env.local", "ACCESS_DENIED", "root .env.local is refused");
  await expectReject("src/.env", "ACCESS_DENIED", "nested .env is refused");
  await expectReject("src/secret-notes.txt", "ACCESS_DENIED", "secret-named file is refused");

  console.log("\n== Excluded directories ==");
  await expectReject("node_modules/x.js", "ACCESS_DENIED", "node_modules is refused");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
