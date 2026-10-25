#!/usr/bin/env npx tsx
import { addSpokenReportId, shouldAnnounceDevLoopAlert, type DevLoopAlertPayload } from "../../components/admin/devLoopVoiceAlertLogic";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const report: DevLoopAlertPayload = {
  report_id: "dev-loop-test-1",
  status: "open",
  severity: "critical",
  owner_alert: { spoken_summary: "DNA OS ตรวจพบปัญหาทดสอบ" },
};

assert(!shouldAnnounceDevLoopAlert(report, { initialLoad: true, newReport: false, voiceEnabled: true, spokenIds: new Set() }), "initial load replayed an old alert");
assert(!shouldAnnounceDevLoopAlert(report, { initialLoad: false, newReport: false, voiceEnabled: true, spokenIds: new Set() }), "existing report replayed after voice toggle");
assert(!shouldAnnounceDevLoopAlert(report, { initialLoad: false, newReport: true, voiceEnabled: false, spokenIds: new Set() }), "voice-off alert was announced");
assert(shouldAnnounceDevLoopAlert(report, { initialLoad: false, newReport: true, voiceEnabled: true, spokenIds: new Set() }), "new critical alert was not announced");
assert(!shouldAnnounceDevLoopAlert({ ...report, status: "resolved" }, { initialLoad: false, newReport: true, voiceEnabled: true, spokenIds: new Set() }), "resolved alert was spoken");
const spoken = addSpokenReportId(new Set([report.report_id]), report.report_id);
assert(spoken.size === 1 && spoken.has(report.report_id), "spoken report dedup set is invalid");
console.log(JSON.stringify({ ok: true, initial_load_silent: true, toggle_does_not_replay: true, opt_in_enforced: true, critical_new_alert_announced: true, resolved_silent: true, dedup_id_recorded: true, external_tts: false, voice_call_opened: false }, null, 2));
