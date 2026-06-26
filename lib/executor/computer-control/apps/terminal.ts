import { ActionResult, AppController } from "../types";
import { runAppleScript, escapeAppleScript } from "../osascript";

const APP = "Terminal";

export const terminalController: AppController = {
  appName: APP,
  bundleId: "com.apple.Terminal",
  actions: {
    open: async () => act("open", async () => {
      await runAppleScript(`tell application "${APP}" to activate`);
      return { opened: APP };
    }),

    run_command: async (args) => act("run_command", async () => {
      const cmd = args.command as string;
      await runAppleScript(`
        tell application "${APP}"
          activate
          do script "${escapeAppleScript(cmd)}"
        end tell
      `);
      return { executed: cmd };
    }),

    run_in_tab: async (args) => act("run_in_tab", async () => {
      const cmd = args.command as string;
      await runAppleScript(`
        tell application "${APP}"
          activate
          tell application "System Events"
            keystroke "t" using command down
          end tell
          delay 0.3
          do script "${escapeAppleScript(cmd)}" in selected tab of window 1
        end tell
      `);
      return { executed: cmd, newTab: true };
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
    return { status: "success", action: `app.terminal.${action}`, target: APP, durationMs: Date.now() - start, result };
  } catch (e) {
    return { status: "failed", action: `app.terminal.${action}`, target: APP, durationMs: Date.now() - start, error: (e as Error).message };
  }
}
