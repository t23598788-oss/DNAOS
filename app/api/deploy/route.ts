import { NextResponse } from "next/server";
import { requireAuth } from "@/core/auth/requireAuth";
import { ADMIN_TIER } from "@/core/auth/session";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();

function getGitInfo() {
  try {
    const hash = execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: "pipe" })
      .toString().trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: ROOT, stdio: "pipe" })
      .toString().trim();
    const message = execSync("git log -1 --format=%s", { cwd: ROOT, stdio: "pipe" })
      .toString().trim();
    const author = execSync("git log -1 --format=%an", { cwd: ROOT, stdio: "pipe" })
      .toString().trim();
    const date = execSync("git log -1 --format=%ci", { cwd: ROOT, stdio: "pipe" })
      .toString().trim();
    return { hash, branch, message, author, date };
  } catch {
    return null;
  }
}

function getVercelInfo() {
  const p = join(ROOT, ".vercel/project.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

// GET /api/deploy — ข้อมูล deployment ปัจจุบัน
// Real, live security fix (TASK-001, DNA-000070): was unauthenticated, leaked
// real filesystem paths, git commit history, and Vercel project config.
export async function GET() {
  const auth = await requireAuth(ADMIN_TIER);
  if (auth instanceof NextResponse) return auth;

  const git = getGitInfo();
  const vercel = getVercelInfo();

  return NextResponse.json({
    git,
    vercel,
    environment: process.env.NODE_ENV ?? "development",
    platform: process.platform,
    node_version: process.version,
    cwd: ROOT,
  });
}
