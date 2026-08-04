export interface DevLoopAlertPayload {
  report_id: string;
  status: "open" | "resolved";
  severity: "warning" | "critical";
  owner_alert?: { spoken_summary?: string };
}

export function shouldAnnounceDevLoopAlert(
  report: DevLoopAlertPayload,
  opts: { initialLoad: boolean; newReport: boolean; voiceEnabled: boolean; spokenIds: ReadonlySet<string> },
): boolean {
  return Boolean(
    !opts.initialLoad &&
    opts.newReport &&
    opts.voiceEnabled &&
    report.status === "open" &&
    report.severity === "critical" &&
    report.owner_alert?.spoken_summary &&
    !opts.spokenIds.has(report.report_id),
  );
}

export function addSpokenReportId(ids: ReadonlySet<string>, reportId: string, max = 50): Set<string> {
  const next = new Set(ids);
  next.add(reportId);
  while (next.size > max) next.delete(next.values().next().value as string);
  return next;
}
