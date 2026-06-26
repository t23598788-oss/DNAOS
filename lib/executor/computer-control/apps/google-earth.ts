import { ActionResult, AppController } from "../types";
import { runAppleScript } from "../osascript";

const APP = "Google Earth Pro";

export const googleEarthController: AppController = {
  appName: "Google Earth",
  bundleId: "com.google.earth",
  actions: {
    open: async () => act("open", async () => {
      await runAppleScript(`tell application "${APP}" to activate`);
      return { opened: APP };
    }),

    fly_to: async (args) => act("fly_to", async () => {
      const lat = args.lat as number;
      const lng = args.lng as number;
      const alt = (args.altitude as number) ?? 1000;
      await runAppleScript(`
        tell application "${APP}"
          activate
          SetViewKmlString "<LookAt><longitude>${lng}</longitude><latitude>${lat}</latitude><altitude>${alt}</altitude><range>1000</range><tilt>60</tilt></LookAt>"
        end tell
      `);
      return { flyTo: { lat, lng, altitude: alt } };
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
    return { status: "success", action: `app.google_earth.${action}`, target: APP, durationMs: Date.now() - start, result };
  } catch (e) {
    return { status: "failed", action: `app.google_earth.${action}`, target: APP, durationMs: Date.now() - start, error: (e as Error).message };
  }
}
