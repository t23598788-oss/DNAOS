import { ActionResult, AppController } from "../types";
import { runAppleScript } from "../osascript";

const APP = "GitHub Desktop";

export const githubDesktopController: AppController = {
  appName: APP,
  bundleId: "com.github.GitHubClient",
  actions: {
    open: async () => act("open", async () => {
      await runAppleScript(`tell application "${APP}" to activate`);
      return { opened: APP };
    }),

    commit: async (args) => act("commit", async () => {
      const message = args.message as string | undefined;
      await runAppleScript(`tell application "${APP}" to activate`);
      if (message) {
        await new Promise((r) => setTimeout(r, 500));
        await runAppleScript(`
          tell application "System Events"
            tell process "${APP}"
              keystroke "${message}"
              delay 0.3
              keystroke return using command down
            end tell
          end tell
        `);
      }
      return { commit: message ?? "manual" };
    }),

    push: async () => act("push", async () => {
      await runAppleScript(`
        tell application "${APP}" to activate
        delay 0.3
        tell application "System Events"
          keystroke "p" using command down
        end tell
      `);
      return { pushed: true };
    }),

    pull: async () => act("pull", async () => {
      await runAppleScript(`
        tell application "${APP}" to activate
        delay 0.3
        tell application "System Events"
          keystroke "p" using {command down, shift down}
        end tell
      `);
      return { pulled: true };
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
    return { status: "success", action: `app.github_desktop.${action}`, target: APP, durationMs: Date.now() - start, result };
  } catch (e) {
    return { status: "failed", action: `app.github_desktop.${action}`, target: APP, durationMs: Date.now() - start, error: (e as Error).message };
  }
}
