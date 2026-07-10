/**
 * Evaluation Engine — ตรวจว่าผลลัพธ์ตรงกับเป้าหมายหรือไม่
 *
 * อยู่ระหว่าง Executor กับ Reflection
 *
 * Executor บอกว่า "ทำแล้ว"
 * Evaluation บอกว่า "ทำสำเร็จจริงหรือเปล่า ตรงตามที่ตั้งใจไหม"
 * Reflection บอกว่า "เรียนรู้อะไรจากผลลัพธ์นี้"
 *
 * Pure Function
 */

import type { WorldState } from "../state/types";

export interface ExecutionOutput {
  tool: string;
  success: boolean;
  data: any;
  error?: string;
  duration_ms?: number;
}

export interface EvaluationResult {
  overall_success: boolean;
  goal_achieved: boolean;
  completeness: number;
  gaps: EvaluationGap[];
  quality: "excellent" | "good" | "partial" | "failed";
  should_retry: boolean;
  should_ask_user: boolean;
  ask_user_what: string | null;
  next_recommendation: string | null;
}

export interface EvaluationGap {
  what: string;
  reason: string;
  recoverable: boolean;
}

export function evaluate(
  executionOutputs: ExecutionOutput[],
  worldState: WorldState,
  expectedOutcome: string,
  successCriteria: string[],
): EvaluationResult {

  const allSuccess = executionOutputs.every(o => o.success);
  const failedSteps = executionOutputs.filter(o => !o.success);
  const successSteps = executionOutputs.filter(o => o.success);
  const gaps: EvaluationGap[] = [];

  // ── ตรวจว่าทุก step สำเร็จไหม ──
  for (const failed of failedSteps) {
    gaps.push({
      what: `${failed.tool} ล้มเหลว`,
      reason: failed.error ?? "ไม่ทราบสาเหตุ",
      recoverable: failed.tool.includes("query"),
    });
  }

  // ── ตรวจว่าข้อมูลครบไหม ──
  const hasData = successSteps.some(o => {
    if (!o.data) return false;
    if (Array.isArray(o.data)) return o.data.length > 0;
    return Object.keys(o.data).length > 0;
  });

  if (!hasData && executionOutputs.length > 0) {
    gaps.push({
      what: "ไม่มีข้อมูล",
      reason: "Tool ทำงานสำเร็จแต่ไม่มีข้อมูลกลับมา",
      recoverable: false,
    });
  }

  // ── ตรวจ identity resolution ──
  const identityStep = executionOutputs.find(o => o.tool === "identity.resolve");
  if (identityStep) {
    const results = Array.isArray(identityStep.data) ? identityStep.data : [identityStep.data];
    if (results.length === 0) {
      gaps.push({ what: "ไม่พบลูกค้า", reason: "ค้นหาไม่เจอ", recoverable: false });
    } else if (results.length > 1) {
      gaps.push({ what: `พบหลายรายการ (${results.length})`, reason: "ต้องให้ผู้ใช้เลือก", recoverable: true });
    }
  }

  // ── ตรวจ success criteria ──
  let criteriaMet = 0;
  for (const criterion of successCriteria) {
    if (criterion.includes("แสดงข้อมูลครบ") && hasData) criteriaMet++;
    else if (criterion.includes("ไม่ถามข้อมูลที่มี") && !gaps.some(g => g.what.includes("ถาม"))) criteriaMet++;
    else if (criterion.includes("เสนอ Action") && allSuccess) criteriaMet++;
    else if (criterion.includes("สร้าง") && successSteps.some(o => o.tool.includes("create"))) criteriaMet++;
    else criteriaMet++;
  }
  const completeness = successCriteria.length > 0 ? criteriaMet / successCriteria.length : (allSuccess ? 1.0 : 0.0);

  // ── ตัดสินคุณภาพ ──
  let quality: EvaluationResult["quality"];
  if (allSuccess && completeness >= 0.9) quality = "excellent";
  else if (allSuccess && completeness >= 0.6) quality = "good";
  else if (successSteps.length > 0) quality = "partial";
  else quality = "failed";

  // ── ต้อง retry / ถามผู้ใช้ ──
  const shouldRetry = failedSteps.some(f => f.tool.includes("query"));
  const multipleResults = gaps.some(g => g.what.includes("หลายรายการ"));
  const shouldAsk = multipleResults || (!hasData && !shouldRetry);

  // ── Goal achieved ──
  const goalAchieved = allSuccess && completeness >= 0.8 && !multipleResults;

  return {
    overall_success: allSuccess,
    goal_achieved: goalAchieved,
    completeness: Math.round(completeness * 100) / 100,
    gaps,
    quality,
    should_retry: shouldRetry && !allSuccess,
    should_ask_user: shouldAsk,
    ask_user_what: multipleResults ? "พบหลายรายการ เลือกรายไหนครับ" : null,
    next_recommendation: goalAchieved ? null : shouldRetry ? "ลองใหม่" : "ถามผู้ใช้เพิ่ม",
  };
}
