"use client";

// UIKit — Timeline
// เส้นเวลาแนวตั้งทั่วไป ใช้ได้กับทั้ง partner timeline, debt timeline, transaction timeline ฯลฯ
// รับเฉพาะ props.events — ไม่ผูกกับ business event ชนิดใดชนิดหนึ่งโดยเฉพาะ

import Window from "./Window";
import EmptyState from "./EmptyState";
import { History } from "lucide-react";

export interface TimelineEvent {
  id: string;
  label: string;
  detail?: string;
  timestamp: string;
  tone?: "default" | "success" | "warning" | "danger";
}

const dotClass: Record<string, string> = {
  default: "bg-stone-600",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
};

export default function Timeline({
  title = "Timeline",
  events,
  onClose,
}: {
  title?: string;
  events: TimelineEvent[];
  onClose: () => void;
}) {
  return (
    <Window title={title} icon={<History className="w-4 h-4 text-stone-400" />} onClose={onClose}>
      {events.length === 0 ? (
        <EmptyState message="ยังไม่มีเหตุการณ์" />
      ) : (
        <ol className="p-4 space-y-4">
          {events.map((ev, i) => (
            <li key={ev.id} className="relative pl-5">
              {i !== events.length - 1 && (
                <span className="absolute left-[3px] top-3 bottom-[-16px] w-px bg-stone-200" />
              )}
              <span
                className={"absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full " + dotClass[ev.tone ?? "default"]}
              />
              <p className="text-xs font-medium text-stone-800">{ev.label}</p>
              {ev.detail && <p className="text-[11px] text-stone-500 mt-0.5">{ev.detail}</p>}
              <p className="text-[10px] text-stone-400 mt-1">{ev.timestamp}</p>
            </li>
          ))}
        </ol>
      )}
    </Window>
  );
}
