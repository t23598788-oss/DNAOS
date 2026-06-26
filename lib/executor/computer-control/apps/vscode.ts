import { ActionResult, AppController } from "../types";
import { runAppleScript, escapeAppleScript, runShell } from "../osascript";

const APP = "Visual Studio Code";

export const vscodeController: AppController = {
  appName: "VS Code",
  bundleId: "com.microsoft.VSCode",
  actions: {
    open: async () => act("open", async () => {
      await runAppleScript(`tell application "${APP}" to activate`);
      return { opened: APP };
    }),

    open_file: async (args) => act("open_file", async () => {
      const path = args.path as string;
      await runShell("code", [path]);
      return { opened: path };
    }),

    open_folder: async (args) => act("open_folder", async () => {
      const path = args.path as string;
      await runShell("code", [path]);
      return { opened: path };
    }),

    new_file: async () => act("new_file", async () => {
      await runAppleScript(`
        tell application "${APP}" to activate
        delay 0.3
        tell application "System Events"
          keystroke "n" using command down
        end tell
      `);
      return { created: "new file" };
    }),

    open_terminal: async () => act("open_terminal", async () => {
      await runAppleScript(`
        tell application "${APP}" to activate
        delay 0.3
        tell application "System Events"
          keystroke "\`" using control down
        end tell
      `);
      return { terminal: "opened" };
    }),

    command_palette: async (args) => act("command_palette", async () => {
      const command = args.command as string | undefined;
      await runAppleScript(`
        tell application "${APP}" to activate
        delay 0.3
        tell application "System Events"
          keystroke "p" using {command down, shift down}
        end tell
      `);
      if (command) {
        await new Promise((r) => setTimeout(r, 300));
        await runAppleScript(`
          tell application "System Events"
            keystroke "${escapeAppleScript(command)}"
            delay 0.3
            key code 36
          end tell
        `);
      }
      return { commandPalette: command ?? "opened" };
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
    return { status: "success", action: `app.vscode.${action}`, target: APP, durationMs: Date.now() - start, result };
  } catch (e) {
    return { status: "failed", action: `app.vscode.${action}`, target: APP, durationMs: Date.now() - start, error: (e as Error).message };
  }
}
