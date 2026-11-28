"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speak } from "./ttsSpeak";
import {
  addSpokenReportId,
  shouldAnnounceDevLoopAlert,
  type DevLoopAlertPayload,
} from "./devLoopVoiceAlertLogic";

const VOICE_SETTING_KEY = "dnaos.dev-loop.voice-alerts";
const SPOKEN_IDS_KEY = "dnaos.dev-loop.voice-alerts.spoken-ids";

function readVoiceSetting(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(VOICE_SETTING_KEY) === "on";
}

function readSpokenIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(window.localStorage.getItem(SPOKEN_IDS_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export default function DevLoopVoiceAlerts() {
  const [voiceEnabled, setVoiceEnabled] = useState(readVoiceSetting);
  const [speechAvailable] = useState(() => typeof window !== "undefined" && ("speechSynthesis" in window || "__TAURI_INTERNALS__" in window));
  const [report, setReport] = useState<DevLoopAlertPayload | null>(null);
  const spokenIdsRef = useRef<Set<string>>(readSpokenIds());
  const initialLoadRef = useRef(true);
  const latestReportIdRef = useRef<string | null>(null);

  const loadReport = useCallback(async () => {
    const res = await fetch("/api/admin/dev-loop/problem-report", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json() as { report?: DevLoopAlertPayload | null };
    if (!body.report) return;
    const next = body.report;
    const newReport = latestReportIdRef.current !== null && latestReportIdRef.current !== next.report_id;
    setReport(next);
    if (shouldAnnounceDevLoopAlert(next, {
      initialLoad: initialLoadRef.current,
      newReport,
      voiceEnabled,
      spokenIds: spokenIdsRef.current,
    })) {
      spokenIdsRef.current = addSpokenReportId(spokenIdsRef.current, next.report_id);
      window.localStorage.setItem(SPOKEN_IDS_KEY, JSON.stringify([...spokenIdsRef.current]));
      void speak(next.owner_alert?.spoken_summary ?? "DNA OS แจ้งเตือนปัญหาใหม่");
    }
    if (newReport && next.status === "open" && next.severity === "critical" && !spokenIdsRef.current.has(next.report_id)) {
      // Mark alerts observed while voice is off so enabling it later does not
      // replay an old incident as if it were new.
      spokenIdsRef.current = addSpokenReportId(spokenIdsRef.current, next.report_id);
      window.localStorage.setItem(SPOKEN_IDS_KEY, JSON.stringify([...spokenIdsRef.current]));
    }
    latestReportIdRef.current = next.report_id;
    initialLoadRef.current = false;
  }, [voiceEnabled]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => void loadReport(), 0);
    const timer = window.setInterval(() => void loadReport(), 15000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [loadReport]);

  function toggleVoice() {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    window.localStorage.setItem(VOICE_SETTING_KEY, next ? "on" : "off");
    if (!next && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  return (
    <section style={{ marginBottom: 24, padding: 12, border: "1px solid #e5e5e5", borderRadius: 8, background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Owner problem alerts</div>
          <div style={{ color: "#777", fontSize: 12 }}>
            {report?.status === "open" ? report.owner_alert?.spoken_summary : "ไม่มีปัญหาเปิดค้างอยู่"}
          </div>
        </div>
        <button
          type="button"
          onClick={toggleVoice}
          disabled={!speechAvailable}
          aria-pressed={voiceEnabled}
          title={!speechAvailable ? "เบราว์เซอร์นี้ไม่มี local speech capability" : undefined}
          style={{ border: "1px solid #ddd", borderRadius: 6, padding: "6px 10px", cursor: speechAvailable ? "pointer" : "not-allowed", opacity: speechAvailable ? 1 : 0.5 }}
        >
          {voiceEnabled ? "🔊 เสียงแจ้งเตือน: เปิด" : "🔇 เสียงแจ้งเตือน: ปิด"}
        </button>
      </div>
      {report?.status === "resolved" && <div style={{ color: "#1e9e5a", fontSize: 12, marginTop: 8 }}>ปัญหาล่าสุดได้รับการแก้สถานะแล้ว — ไม่พูดซ้ำ</div>}
      <div style={{ color: "#999", fontSize: 11, marginTop: 8 }}>เสียงจะทำงานเฉพาะขณะหน้านี้เปิดและเปิดสวิตช์เองเท่านั้น ระบบไม่เปิด voice call ที่ปิดไปแล้ว</div>
    </section>
  );
}
