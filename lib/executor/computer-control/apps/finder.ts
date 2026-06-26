import { ActionResult, AppController } from "../types";
import { runAppleScript, escapeAppleScript } from "../osascript";

const APP = "Finder";

export const finderController: AppController = {
  appName: APP,
  bundleId: "com.apple.finder",
  actions: {
    open: async () => act("open", async () => {
      await runAppleScript(`tell application "${APP}" to activate`);
      return { opened: APP };
    }),

    open_folder: async (args) => act("open_folder", async () => {
      const path = args.path as string;
      await runAppleScript(`
        tell application "${APP}"
          activate
          open POSIX file "${escapeAppleScript(path)}"
        end tell
      `);
      return { opened: path };
    }),

    reveal_file: async (args) => act("reveal_file", async () => {
      const path = args.path as string;
      await runAppleScript(`
        tell application "${APP}"
          activate
          reveal POSIX file "${escapeAppleScript(path)}"
        end tell
      `);
      return { revealed: path };
    }),

    get_selection: async () => act("get_selection", async () => {
      const raw = await runAppleScript(`
        tell application "${APP}"
          set sel to selection
          set paths to {}
          repeat with f in sel
            set end of paths to POSIX path of (f as alias)
          end repeat
          set AppleScript's text item delimiters to "|||"
          return paths as text
        end tell
      `);
      const files = raw.split("|||").filter(Boolean);
      return { selected: files, count: files.length };
    }),

    new_folder: async (args) => act("new_folder", async () => {
      const name = args.name as string;
      const path = args.path as string;
      await runAppleScript(`
        tell application "${APP}"
          make new folder at POSIX file "${escapeAppleScript(path)}" with properties {name:"${escapeAppleScript(name)}"}
        end tell
      `);
      return { created: `${path}/${name}` };
    }),

    close: async () => act("close", async () => {
      await runAppleScript(`
        tell application "${APP}"
          close every window
        end tell
      `);
      return { closed: "all Finder windows" };
    }),
  },
};

async function act(action: string, fn: () => Promise<unknown>): Promise<ActionResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return { status: "success", action: `app.finder.${action}`, target: APP, durationMs: Date.now() - start, result };
  } catch (e) {
    return { status: "failed", action: `app.finder.${action}`, target: APP, durationMs: Date.now() - start, error: (e as Error).message };
  }
}
