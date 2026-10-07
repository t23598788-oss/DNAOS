/**
 * หน้าที่: the two channels a changed resource opens toward an active
 * execution — and they are two channels, not one (Owner, 2026-08-26).
 *
 *   INTERRUPT: "stop advancing the affected work until this is reconciled"
 *   CONTEXT:   "this resource changed; here is what is proven about it"
 *
 * They are delivered as separate files with separate schemas, because they mean
 * different things and an execution may legitimately act on one without the
 * other.
 *
 * WHY FILES AND NOT A SIGNAL: SIGSTOP would freeze a process wherever it
 * happened to be — mid-write, mid-commit, holding a lock. An interrupt that
 * lands at an arbitrary instruction is not a safe execution boundary. The
 * inbox lets the execution notice the interrupt at ITS OWN next boundary and
 * report what state it stopped in. That is also why the ack is READ from the
 * agent rather than assumed: "paused" is something the execution says, not
 * something this file decides on its behalf.
 *
 * THE INTERRUPT AUTHORIZES NOTHING. It carries no capability, no grant, no
 * command, no path it may write. `authorizes: "NOTHING"` is stated in the
 * signal itself so a receiver never has to infer it. This file also never
 * kills a process, never creates work, and never touches source.
 *
 * Input: an `InterruptSignal`/`ChangeImpactContext` and the target's workspace.
 * Output: files under `<workspace>/.dna-os/`, and whatever ack the execution
 * really wrote.
 * Dependency ที่อนุญาต: ./types.ts, node built-ins.
 * สิ่งที่ห้ามแตะ:
 * - ห้ามส่ง signal ที่ฆ่าหรือแก้ process.
 * - ห้ามเขียนอะไรนอก `<workspace>/.dna-os/`.
 * - ห้ามสมมติว่า agent หยุดแล้ว — ack ต้องมาจาก agent จริงเท่านั้น.
 */

declare const require: any;

import type { AgentAck, ChangeImpactContext, InterruptSignal } from "./types";

const fs = require("node:fs");
const path = require("node:path");

export const INBOX_DIR = ".dna-os";
export const INTERRUPT_FILE = "interrupt.json";
export const CONTEXT_FILE = "change-context.json";
export const ACK_FILE = "ack.json";

function inbox(workspaceDir: string): string {
  return path.join(workspaceDir, INBOX_DIR);
}

/** CHANNEL 1 — the interrupt. Nothing else is written by this call. */
export function deliverInterrupt(workspaceDir: string, signal: InterruptSignal): { delivered: true; file: string } | { delivered: false; reason: string } {
  try {
    fs.mkdirSync(inbox(workspaceDir), { recursive: true });
    const file = path.join(inbox(workspaceDir), INTERRUPT_FILE);
    fs.writeFileSync(file, JSON.stringify(signal, null, 1));
    return { delivered: true, file };
  } catch (error) {
    return { delivered: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** CHANNEL 2 — the context. Separate file, separate call, separate schema. */
export function deliverContext(workspaceDir: string, context: ChangeImpactContext): { delivered: true; file: string } | { delivered: false; reason: string } {
  try {
    fs.mkdirSync(inbox(workspaceDir), { recursive: true });
    const file = path.join(inbox(workspaceDir), CONTEXT_FILE);
    fs.writeFileSync(file, JSON.stringify(context, null, 1));
    return { delivered: true, file };
  } catch (error) {
    return { delivered: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Reads what the execution actually reported. `null` means it has not answered — never "probably paused". */
export function readAck(workspaceDir: string): AgentAck | null {
  try {
    return JSON.parse(String(fs.readFileSync(path.join(inbox(workspaceDir), ACK_FILE), "utf8"))) as AgentAck;
  } catch {
    return null;
  }
}

/** The receiving half, for an execution that wants to cooperate. Reading an interrupt is not obeying it — the execution decides when its next safe boundary is. */
export function readInterrupt(workspaceDir: string): InterruptSignal | null {
  try {
    return JSON.parse(String(fs.readFileSync(path.join(inbox(workspaceDir), INTERRUPT_FILE), "utf8"))) as InterruptSignal;
  } catch {
    return null;
  }
}

export function writeAck(workspaceDir: string, ack: AgentAck): void {
  fs.mkdirSync(inbox(workspaceDir), { recursive: true });
  fs.writeFileSync(path.join(inbox(workspaceDir), ACK_FILE), JSON.stringify(ack, null, 1));
}
