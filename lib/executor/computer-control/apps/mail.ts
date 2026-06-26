import { ActionResult, AppController } from "../types";
import { runAppleScript, escapeAppleScript } from "../osascript";

const APP = "Mail";

export const mailController: AppController = {
  appName: APP,
  bundleId: "com.apple.mail",
  actions: {
    open: async () => act("open", async () => {
      await runAppleScript(`tell application "${APP}" to activate`);
      return { opened: APP };
    }),

    compose: async (args) => act("compose", async () => {
      const to = args.to as string;
      const subject = args.subject as string ?? "";
      const body = args.body as string ?? "";
      await runAppleScript(`
        tell application "${APP}"
          activate
          set newMsg to make new outgoing message with properties {subject:"${escapeAppleScript(subject)}", content:"${escapeAppleScript(body)}", visible:true}
          tell newMsg
            make new to recipient with properties {address:"${escapeAppleScript(to)}"}
          end tell
        end tell
      `);
      return { composing: { to, subject } };
    }),

    send: async (args) => act("send", async () => {
      const to = args.to as string;
      const subject = args.subject as string ?? "";
      const body = args.body as string ?? "";
      await runAppleScript(`
        tell application "${APP}"
          set newMsg to make new outgoing message with properties {subject:"${escapeAppleScript(subject)}", content:"${escapeAppleScript(body)}", visible:true}
          tell newMsg
            make new to recipient with properties {address:"${escapeAppleScript(to)}"}
          end tell
          send newMsg
        end tell
      `);
      return { sent: { to, subject } };
    }),

    check_mail: async () => act("check_mail", async () => {
      await runAppleScript(`
        tell application "${APP}"
          activate
          check for new mail
        end tell
      `);
      return { checked: true };
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
    return { status: "success", action: `app.mail.${action}`, target: APP, durationMs: Date.now() - start, result };
  } catch (e) {
    return { status: "failed", action: `app.mail.${action}`, target: APP, durationMs: Date.now() - start, error: (e as Error).message };
  }
}
