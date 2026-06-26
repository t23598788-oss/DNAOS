import { ActionResult, AppController } from "../types";
import { runAppleScript, escapeAppleScript } from "../osascript";

const APP = "Calendar";

export const calendarController: AppController = {
  appName: APP,
  bundleId: "com.apple.iCal",
  actions: {
    open: async () => act("open", async () => {
      await runAppleScript(`tell application "${APP}" to activate`);
      return { opened: APP };
    }),

    create_event: async (args) => act("create_event", async () => {
      const title = args.title as string;
      const date = args.date as string;
      const startHour = (args.startHour as number) ?? 9;
      const endHour = (args.endHour as number) ?? 10;
      const notes = (args.notes as string) ?? "";

      await runAppleScript(`
        tell application "${APP}"
          tell calendar "Home"
            set startDate to current date
            set year of startDate to text 1 thru 4 of "${date}" as integer
            set month of startDate to text 6 thru 7 of "${date}" as integer
            set day of startDate to text 9 thru 10 of "${date}" as integer
            set hours of startDate to ${startHour}
            set minutes of startDate to 0
            set seconds of startDate to 0
            set endDate to startDate + (${endHour - startHour} * hours)
            make new event with properties {summary:"${escapeAppleScript(title)}", start date:startDate, end date:endDate, description:"${escapeAppleScript(notes)}"}
          end tell
        end tell
      `);
      return { created: { title, date, startHour, endHour } };
    }),

    today: async () => act("today", async () => {
      await runAppleScript(`
        tell application "${APP}"
          activate
          switch view to day view
          view calendar at current date
        end tell
      `);
      return { viewing: "today" };
    }),

    close: async () => act("close", async () => {
      await runAppleScript(`tell application "${APP}" to quit`);
      return { closed: APP };
    }),
  },
};

async function act(action: string, fn: () => Promise<unknown>): Promise<ActionResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return { status: "success", action: `app.calendar.${action}`, target: APP, durationMs: Date.now() - start, result };
  } catch (e) {
    return { status: "failed", action: `app.calendar.${action}`, target: APP, durationMs: Date.now() - start, error: (e as Error).message };
  }
}
