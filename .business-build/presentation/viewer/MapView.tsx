"use client";

// UIKit — MapView
// พื้นที่แสดงตำแหน่ง/เส้นทาง (เช่น engines/distance.ts, vehicle-selector.ts) — ตัว component นี้ "โง่" โดยตั้งใจ
// ไม่ผูก map provider ใดไว้ตายตัว รับแค่ markers (lat/lng/label) มา render เป็นจุดบน grid เปล่า ๆ
// การเชื่อมกับ Google Maps/Mapbox จริงทำที่ชั้น services (I/O boundary) แล้วส่ง markers ที่คำนวณแล้วเข้ามาที่นี่

import Window from "@/presentation/panels/Window";
import EmptyState from "@/presentation/feedback/EmptyState";
import { MapPin } from "lucide-react";

export interface MapMarker {
  id: string;
  label: string;
  x: number; // 0-100 (% ของกรอบ) — คำนวณมาจากชั้นบริการ ไม่ใช่ lat/lng ดิบ
  y: number; // 0-100
  tone?: "default" | "success" | "warning" | "danger";
}

const dotClass: Record<string, string> = {
  default: "bg-stone-400 border-stone-300",
  success: "bg-emerald-500 border-emerald-300",
  warning: "bg-amber-500 border-amber-300",
  danger: "bg-rose-500 border-rose-300",
};

export default function MapView({
  title = "Map",
  markers,
  onClose,
}: {
  title?: string;
  markers: MapMarker[];
  onClose: () => void;
}) {
  return (
    <Window title={title} icon={<MapPin className="w-4 h-4 text-stone-400" />} onClose={onClose} width={440}>
      <div className="relative w-full aspect-[4/3] bg-stone-50 bg-[linear-gradient(rgba(0,0,0,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.04)_1px,transparent_1px)] bg-[length:24px_24px]">
        {markers.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyState message="ยังไม่มีจุดพิกัด" />
          </div>
        )}
        {markers.map((m) => (
          <div
            key={m.id}
            title={m.label}
            style={{ left: m.x + "%", top: m.y + "%" }}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1"
          >
            <span className={"w-2.5 h-2.5 rounded-full border-2 " + dotClass[m.tone ?? "default"]} />
            <span className="text-[9px] text-stone-600 bg-white/90 border border-stone-200 px-1 rounded whitespace-nowrap">{m.label}</span>
          </div>
        ))}
      </div>
    </Window>
  );
}
