import { ActionResult, AppController } from "../types";
import { runAppleScript, escapeAppleScript } from "../osascript";

const APP = "Preview";

export const pdfViewerController: AppController = {
  appName: "PDF Viewer",
  bundleId: "com.apple.Preview",
  actions: {
    open: async () => act("open", async () => {
      await runAppleScript(`tell application "${APP}" to activate`);
      return { opened: APP };
    }),

    open_file: async (args) => act("open_file", async () => {
      const path = args.path as string;
      await runAppleScript(`
        tell application "${APP}"
          activate
          open POSIX file "${escapeAppleScript(path)}"
        end tell
      `);
      return { opened: path };
    }),

    print: async () => act("print", async () => {
      await runAppleScript(`
        tell application "${APP}" to activate
        delay 0.3
        tell application "System Events"
          keystroke "p" using command down
        end tell
      `);
      return { printDialog: "opened" };
    }),

    export_pdf: async () => act("export_pdf", async () => {
      await runAppleScript(`
        tell application "${APP}" to activate
        delay 0.3
        tell application "System Events"
          keystroke "e" using command down
        end tell
      `);
      return { exportDialog: "opened" };
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
    return { status: "success", action: `app.pdf_viewer.${action}`, target: APP, durationMs: Date.now() - start, result };
  } catch (e) {
    return { status: "failed", action: `app.pdf_viewer.${action}`, target: APP, durationMs: Date.now() - start, error: (e as Error).message };
  }
}
