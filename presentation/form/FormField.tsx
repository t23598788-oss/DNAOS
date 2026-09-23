"use client";

// presentation/form — FormField (canonical FORM primitive, Phase 3)
//
// Phase 2 §7 proved this is a real gap: there is no form primitive anywhere
// (44 files hand-write <input>/<select>/<textarea>, <label> appears 15×/2×/1× in
// three different files, `disabled=` is repeated in DocumentBuilder/login, and every
// page renders its own `{error && …}` block).
//
// Scope discipline: this primitive owns ONLY the parts that are currently duplicated
// everywhere — the label, the required marker, the error/hint wiring and the disabled
// state — and receives the actual control as `children`.
//
// The control itself is deliberately NOT re-implemented here, because the existing
// inputs each carry their own approved styling (e.g. app/login/page.tsx is OWNER
// LOCKED). Wrapping instead of replacing means no existing input is redesigned and
// no parallel input styling system is created.

import type { ReactNode } from "react";

export interface FormFieldProps {
  /** ต้องตรงกับ id ของ control ที่ส่งมาใน children (ใช้ผูก label/error) */
  id: string;
  label: string;
  required?: boolean;
  disabled?: boolean;
  /** ข้อความ error ที่ผู้เรียก resolve มาแล้ว — primitive ไม่ validate เอง */
  error?: string | null;
  hint?: string;
  children: ReactNode;
  className?: string;
}

export default function FormField({
  id,
  label,
  required = false,
  disabled = false,
  error = null,
  hint,
  children,
  className = "",
}: FormFieldProps) {
  return (
    <div className={"flex flex-col " + className}>
      <label
        htmlFor={id}
        className="text-xs font-medium text-stone-600 mb-1.5"
      >
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </label>

      {/* context ให้ control ที่ส่งเข้ามาอ่าน aria/disabled ได้โดยไม่ต้องรู้จัก form primitive */}
      <div
        data-field-id={id}
        data-field-disabled={disabled ? "true" : "false"}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      >
        {children}
      </div>

      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-600 mt-1.5">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-[11px] text-stone-400 mt-1.5">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
