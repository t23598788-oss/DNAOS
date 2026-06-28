/** Learning — เรียนรู้จาก Reflection เพื่อปรับปรุงการตัดสินใจ */

import type { EvaluationResult } from "../evaluation";
import type { ReflectionOutput } from "../reflection";

export interface LearningOutput {
  lessons: string[];
  should_retry: boolean;
  next_recommendation: string | null;
}

export function learn(reflection: ReflectionOutput, evaluation: EvaluationResult): LearningOutput {
  return {
    lessons: reflection.lessons,
    should_retry: evaluation.should_retry,
    next_recommendation: evaluation.next_recommendation,
  };
}
