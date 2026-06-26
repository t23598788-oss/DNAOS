import { ActionResult, AppController } from "../types";
import { runAppleScript, escapeAppleScript } from "../osascript";

const APP = "LINE";

export const lineController: AppController = {
  appName: APP,
  bundleId: "jp.naver.line.mac",
  actions: {
    open: async () => act("open", async () => {
      await runAppleScript(`tell application "${APP}" to activate`);
      return { opened: APP };
    }),

    search_contact: async (args) => act("search_contact", async () => {
      const name = args.name as string;
      await runAppleScript(`tell application "${APP}" to activate`);
      await delay(500);
      await runAppleScript(`
        tell application "System Events"
          tell process "${APP}"
            keystroke "f" using command down
            delay 0.3
            keystroke "${escapeAppleScript(name)}"
          end tell
        end tell
      `);
      return { searching: name };
    }),

    open_chat: async (args) => act("open_chat", async () => {
      const name = args.name as string;
      await runAppleScript(`tell application "${APP}" to activate`);
      await delay(300);
      await runAppleScript(`
        tell application "System Events"
          tell process "${APP}"
            keystroke "f" using command down
            delay 0.3
            keystroke "${escapeAppleScript(name)}"
            delay 1
            key code 36
          end tell
        end tell
      `);
      return { chatOpened: name };
    }),

    send_message: async (args) => act("send_message", async () => {
      const text = args.text as string;
      await delay(300);
      await runAppleScript(`
        tell application "System Events"
          tell process "${APP}"
            set the clipboard to "${escapeAppleScript(text)}"
            delay 0.1
            keystroke "v" using command down
            delay 0.2
            key code 36
          end tell
        end tell
      `);
      return { sent: text.length + " chars" };
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
    return { status: "success", action: `app.line.${action}`, target: APP, durationMs: Date.now() - start, result };
  } catch (e) {
    return { status: "failed", action: `app.line.${action}`, target: APP, durationMs: Date.now() - start, error: (e as Error).message };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
