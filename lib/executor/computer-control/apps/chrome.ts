import { ActionResult, AppController } from "../types";
import { runAppleScript, escapeAppleScript } from "../osascript";

const APP = "Google Chrome";

export const chromeController: AppController = {
  appName: APP,
  bundleId: "com.google.Chrome",
  actions: {
    open: async () => act("open", async () => {
      await runAppleScript(`tell application "${APP}" to activate`);
      return { opened: APP };
    }),

    open_url: async (args) => act("open_url", async () => {
      const url = args.url as string;
      await runAppleScript(`
        tell application "${APP}"
          activate
          open location "${escapeAppleScript(url)}"
        end tell
      `);
      return { opened: url };
    }),

    new_tab: async (args) => act("new_tab", async () => {
      const url = (args.url as string) ?? "about:blank";
      await runAppleScript(`
        tell application "${APP}"
          activate
          tell window 1
            make new tab with properties {URL:"${escapeAppleScript(url)}"}
          end tell
        end tell
      `);
      return { newTab: url };
    }),

    get_url: async () => act("get_url", async () => {
      const url = await runAppleScript(`
        tell application "${APP}"
          return URL of active tab of window 1
        end tell
      `);
      return { url };
    }),

    get_title: async () => act("get_title", async () => {
      const title = await runAppleScript(`
        tell application "${APP}"
          return title of active tab of window 1
        end tell
      `);
      return { title };
    }),

    close_tab: async () => act("close_tab", async () => {
      await runAppleScript(`
        tell application "${APP}"
          close active tab of window 1
        end tell
      `);
      return { closed: "active tab" };
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
    return { status: "success", action: `app.chrome.${action}`, target: APP, durationMs: Date.now() - start, result };
  } catch (e) {
    return { status: "failed", action: `app.chrome.${action}`, target: APP, durationMs: Date.now() - start, error: (e as Error).message };
  }
}
