/**
 * Workflow Engine — ไม่รู้จักแอป ไม่รู้จักภาษาไทย
 * โหลด JSON Registry → แตก Steps → ส่ง Driver
 */

import type { AppDriver, WorkflowResult, WorkflowDef } from "@/lib/shared/types";
import { record } from "./audit";
import workflowDefs from "@/lib/commands/workflows.json";

const workflows = workflowDefs as Record<string, WorkflowDef>;

type StepFn = (driver: AppDriver, args: Record<string, string>) => Promise<{ ok: boolean; data?: unknown; error?: string }>;

const steps: Record<string, StepFn> = {
  "launch":         (d) => d.launch(),
  "focus":          (d) => d.focus(),
  "close":          (d) => d.close(),
  "search":         (d, a) => d.search(a.contact ?? a.query ?? ""),
  "read":           (d) => d.read(),
  "submit":         (d) => d.click("submit"),
  "report":         async () => ({ ok: true, data: { reported: true } }),
  "wait_ready":     async () => { await sleep(500);  return { ok: true }; },
  "wait_load":      async () => { await sleep(2000); return { ok: true }; },
  "wait_delivery":  async () => { await sleep(1500); return { ok: true }; },
  "wait_long":      async () => { await sleep(5000); return { ok: true }; },
  "check_all_apps": async () => ({ ok: true, data: { checked: true } }),
  "type":           (d, a) => d.type(a.message ?? a.text ?? ""),
  "type:to":        (d, a) => d.type(a.to ?? ""),
  "type:subject":   (d, a) => d.type(a.subject ?? ""),
  "type:body":      (d, a) => d.type(a.body ?? ""),
  "type:command":   (d, a) => d.type(a.command ?? "vercel --prod"),
  "click:chat":     (d) => d.click("chat"),
  "click:compose":  (d) => d.click("compose"),
  "click:subject":  (d) => d.click("subject"),
  "click:body":     (d) => d.click("body"),
  "shortcut:send":  (d) => d.click("shortcut:d"),
  "shortcut:push":  (d) => d.click("shortcut:p"),
};

export function getWorkflow(name: string): WorkflowDef | undefined {
  return workflows[name];
}

export async function execute(
  workflowName: string,
  args: Record<string, string>,
  driver: AppDriver
): Promise<WorkflowResult> {
  const wf = workflows[workflowName];
  if (!wf) return { ok: false, workflow: workflowName, app: args.app ?? "", steps: [], totalMs: 0, error: `ไม่พบ workflow: ${workflowName}` };

  const start = Date.now();
  const results: WorkflowResult["steps"] = [];

  for (const stepName of wf.steps) {
    const handler = steps[stepName];
    if (!handler) {
      results.push({ step: stepName, status: "failed", durationMs: 0, error: `ไม่พบ step: ${stepName}` });
      record(workflowName, args.app ?? "", stepName, "failed", 0, `ไม่พบ step: ${stepName}`);
      return { ok: false, workflow: workflowName, app: args.app ?? "", steps: results, totalMs: Date.now() - start };
    }

    const ss = Date.now();
    try {
      const r = await handler(driver, args);
      const dur = Date.now() - ss;
      results.push({ step: stepName, status: r.ok ? "success" : "failed", durationMs: dur, data: r.data, error: r.error });
      record(workflowName, args.app ?? "", stepName, r.ok ? "success" : "failed", dur, r.error);
      if (!r.ok) return { ok: false, workflow: workflowName, app: args.app ?? "", steps: results, totalMs: Date.now() - start, error: r.error };
    } catch (e) {
      const dur = Date.now() - ss;
      const err = (e as Error).message;
      results.push({ step: stepName, status: "failed", durationMs: dur, error: err });
      record(workflowName, args.app ?? "", stepName, "failed", dur, err);
      return { ok: false, workflow: workflowName, app: args.app ?? "", steps: results, totalMs: Date.now() - start, error: err };
    }
  }

  return { ok: true, workflow: workflowName, app: args.app ?? "", steps: results, totalMs: Date.now() - start };
}

export function listWorkflows(): string[] { return Object.keys(workflows); }

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
