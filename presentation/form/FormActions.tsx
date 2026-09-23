"use client";

// presentation/form — FormActions (canonical FORM primitive, Phase 3)
//
// Phase 2 §7 found only 4 `type="submit"` buttons in the whole system, each with its
// own hand-written row/alignment. This is the shared action row for a form: it holds
// the buttons the caller passes in and nothing else — no styling of the buttons
// themselves, so no existing button is redesigned and no business action is implied.

import type { ReactNode } from "react";

export interface FormActionsProps {
  children: ReactNode;
  /** ตำแหน่งปุ่มในแถว — ค่าเริ่มต้นคือชิดขวาแบบ form ทั่วไป */
  align?: "left" | "right" | "between";
  className?: string;
}

const ALIGN: Record<NonNullable<FormActionsProps["align"]>, string> = {
  left: "justify-start",
  right: "justify-end",
  between: "justify-between",
};

export default function FormActions({ children, align = "right", className = "" }: FormActionsProps) {
  return (
    <div className={"flex items-center gap-2 pt-2 " + ALIGN[align] + " " + className}>{children}</div>
  );
}
