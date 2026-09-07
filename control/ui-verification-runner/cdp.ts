/**
 * หน้าที่: ตัวขับ Chrome ผ่าน DevTools Protocol แบบบางที่สุดเท่าที่พอใช้ตรวจ
 * หน้าจอจริง — เปิด/สั่ง/อ่านค่า/ปิด ไม่มีอย่างอื่น
 *
 * ทำไมต้อง CDP ไม่ใช่ `--dump-dom` เดิมของ control/ui-render-verification:
 * dump-dom คืน HTML อย่างเดียว บอก bounding box, computed style, console
 * error และ network failure ไม่ได้เลย ซึ่งเป็นค่าที่ Owner สั่งให้ใช้ตัดสิน
 * (2026-09-05) โมดูลเดิมยังใช้ต่อสำหรับการตรวจว่าข้อความปรากฏใน DOM ที่นี่
 * ไม่ได้มาแทน แต่มาเติมสิ่งที่มันทำไม่ได้
 *
 * ทำไมไม่ใช้ playwright/puppeteer: ไม่ได้ติดตั้งในรีโปนี้ และการเพิ่ม
 * dependency ใหม่เกินขอบเขตที่ Owner อนุมัติ node v22+ มี WebSocket กับ fetch
 * ในตัวอยู่แล้ว จึงต่อ CDP ตรงได้โดยไม่เพิ่มอะไร
 *
 * Input: URL ของ Chrome และคำสั่ง CDP
 * Output: ผลลัพธ์ของคำสั่ง และ event ที่เก็บระหว่างเปิดหน้า
 * Dependency ที่อนุญาต: node built-ins เท่านั้น
 * สิ่งที่ห้ามแตะ:
 * - ห้ามใช้ user-data-dir ร่วมกับ Chrome ของ Owner — ต้องเป็นโปรไฟล์แยกเสมอ
 * - ห้ามปล่อยโปรเซสค้าง ต้อง close() ทุกเส้นทางรวมทั้งตอน error
 * - ห้ามเปิด loop ถ่ายภาพหรือ polling ต่อเนื่อง เรียกครั้งเดียวต่อการตรวจ
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export interface ConsoleEntry { readonly level: string; readonly text: string; readonly url: string | null }
export interface NetworkFailure { readonly url: string; readonly status: number | null; readonly error: string | null }

export interface Session {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  /** ประเมิน JS ในหน้า แล้วคืนค่าที่ serialize ได้ — ค่าที่ได้คือค่าเครื่อง ไม่ใช่คำบรรยาย */
  evaluate<T>(expression: string): Promise<T>;
  consoleErrors(): readonly ConsoleEntry[];
  networkFailures(): readonly NetworkFailure[];
  clearObservations(): void;
  navigate(url: string): Promise<void>;
  screenshot(): Promise<string>;
  close(): Promise<void>;
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

async function waitForPort(port: number, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) { const v = (await res.json()) as { webSocketDebuggerUrl?: string }; if (v.webSocketDebuggerUrl) return v.webSocketDebuggerUrl; }
    } catch { /* ยังไม่ขึ้น รอต่อ */ }
    await sleep(120);
  }
  throw new Error(`CHROME_DEVTOOLS_NOT_READY:${port}`);
}

/**
 * เปิด Chrome หนึ่งตัวพร้อมหน้าเปล่าหนึ่งหน้า และคืน session ที่ปิดได้
 * โปรไฟล์เป็นไดเรกทอรีชั่วคราวที่ลบทิ้งตอน close() เสมอ
 */
export async function openSession(options: { port?: number; windowWidth?: number; windowHeight?: number } = {}): Promise<Session> {
  const port = options.port ?? 9500 + Math.floor(Math.random() * 400);
  const width = options.windowWidth ?? 1440;
  const height = options.windowHeight ?? 900;
  const profileDir = mkdtempSync(join(tmpdir(), "dnaos-uiverify-"));

  const child: ChildProcess = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-background-networking", "--mute-audio",
    `--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`,
    `--window-size=${width},${height}`, "about:blank",
  ], { stdio: "ignore" });

  let ws: WebSocket | null = null;
  const consoleErrors: ConsoleEntry[] = [];
  const networkFailures: NetworkFailure[] = [];
  const requestUrls = new Map<string, string>();

  const cleanup = async (): Promise<void> => {
    try { ws?.close(); } catch { /* ปิดไม่ได้ก็ไปต่อ */ }
    try { child.kill("SIGKILL"); } catch { /* โปรเซสอาจตายไปแล้ว */ }
    await sleep(150);
    try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* โปรไฟล์ชั่วคราว ลบไม่ได้ก็ไม่เป็นไร */ }
  };

  try {
    const browserWs = await waitForPort(port, 20_000);
    // เปิดหน้าใหม่หนึ่งหน้าแล้วต่อกับหน้านั้นโดยตรง (ไม่ใช่ browser endpoint)
    const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
    const target = (await created.json()) as { webSocketDebuggerUrl: string };
    void browserWs;

    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("CDP_WS_TIMEOUT")), 15_000);
      ws!.addEventListener("open", () => { clearTimeout(t); resolve(); }, { once: true });
      ws!.addEventListener("error", () => { clearTimeout(t); reject(new Error("CDP_WS_ERROR")); }, { once: true });
    });

    let nextId = 1;
    const pending = new Map<number, { resolve(v: any): void; reject(e: Error): void }>();
    const loadWaiters: (() => void)[] = [];

    ws.addEventListener("message", (event: MessageEvent) => {
      let msg: any;
      try { msg = JSON.parse(String(event.data)); } catch { return; }
      if (typeof msg.id === "number") {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(`CDP:${msg.error.message ?? "error"}`)) : p.resolve(msg.result); }
        return;
      }
      // เก็บ event ที่ใช้ตัดสิน — ค่าดิบจากเบราว์เซอร์ ไม่มีการตีความ
      if (msg.method === "Log.entryAdded" && msg.params?.entry?.level === "error") {
        consoleErrors.push({ level: "error", text: String(msg.params.entry.text ?? ""), url: msg.params.entry.url ?? null });
      } else if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params?.exceptionDetails;
        consoleErrors.push({ level: "exception", text: String(d?.exception?.description ?? d?.text ?? "exception"), url: d?.url ?? null });
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
        const parts = (msg.params.args ?? []).map((a: any) => String(a?.value ?? a?.description ?? "")).join(" ");
        consoleErrors.push({ level: "console.error", text: parts, url: null });
      } else if (msg.method === "Network.requestWillBeSent") {
        requestUrls.set(String(msg.params.requestId), String(msg.params.request?.url ?? ""));
      } else if (msg.method === "Network.responseReceived") {
        const status = Number(msg.params?.response?.status ?? 0);
        if (status >= 400) networkFailures.push({ url: String(msg.params?.response?.url ?? ""), status, error: null });
      } else if (msg.method === "Network.loadingFailed") {
        const url = requestUrls.get(String(msg.params.requestId)) ?? "";
        if (!msg.params?.canceled) networkFailures.push({ url, status: null, error: String(msg.params?.errorText ?? "failed") });
      } else if (msg.method === "Page.loadEventFired") {
        while (loadWaiters.length > 0) loadWaiters.pop()!();
      }
    });

    const send = (method: string, params: Record<string, unknown> = {}): Promise<any> => {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const t = setTimeout(() => { if (pending.delete(id)) reject(new Error(`CDP_TIMEOUT:${method}`)); }, 30_000);
        const settle = (fn: (v: any) => void) => (v: any) => { clearTimeout(t); fn(v); };
        pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
        ws!.send(JSON.stringify({ id, method, params }));
      });
    };

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Network.enable");

    const session: Session = {
      send,
      async evaluate<T>(expression: string): Promise<T> {
        const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (r?.exceptionDetails) throw new Error(`EVAL_FAILED:${r.exceptionDetails.text ?? "error"}`);
        return r?.result?.value as T;
      },
      consoleErrors: () => consoleErrors,
      networkFailures: () => networkFailures,
      clearObservations() { consoleErrors.length = 0; networkFailures.length = 0; },
      async navigate(url: string): Promise<void> {
        const loaded = new Promise<void>((resolve) => { loadWaiters.push(resolve); setTimeout(resolve, 12_000); });
        await send("Page.navigate", { url });
        await loaded;
        // ให้ hash route ที่เรนเดอร์ฝั่ง client ได้เวลาวาดจริงก่อนวัด
        await sleep(1200);
      },
      async screenshot(): Promise<string> {
        const r = await send("Page.captureScreenshot", { format: "png" });
        return String(r?.data ?? "");
      },
      close: cleanup,
    };
    return session;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
