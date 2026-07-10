/**
 * URL Schemes — เปิดโปรแกรมหรือ URL ผ่าน scheme (เช่น raycast://, notion://)
 */

import { runShell } from "./applescript";

export async function open(url: string): Promise<void> {
  const { ok, error } = await runShell("open", [url]);
  if (!ok) throw new Error(`url-schemes.open("${url}") failed: ${error}`);
}

export async function openByScheme(scheme: string, path: string): Promise<void> {
  const url = `${scheme}://${path}`;
  await open(url);
}
