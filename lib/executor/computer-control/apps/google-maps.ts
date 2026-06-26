import { ActionResult, AppController } from "../types";
import { runAppleScript, escapeAppleScript } from "../osascript";

const APP = "Google Chrome";

export const googleMapsController: AppController = {
  appName: "Google Maps",
  bundleId: "com.google.Chrome",
  actions: {
    open: async () => act("open", async () => {
      await runAppleScript(`
        tell application "${APP}"
          activate
          open location "https://maps.google.com"
        end tell
      `);
      return { opened: "Google Maps" };
    }),

    view_location: async (args) => act("view_location", async () => {
      const lat = args.lat as number;
      const lng = args.lng as number;
      const zoom = (args.zoom as number) ?? 15;
      await runAppleScript(`
        tell application "${APP}"
          activate
          open location "https://maps.google.com/@${lat},${lng},${zoom}z"
        end tell
      `);
      return { viewing: { lat, lng, zoom } };
    }),

    get_directions: async (args) => act("get_directions", async () => {
      const from = encodeURIComponent(args.from as string);
      const to = encodeURIComponent(args.to as string);
      await runAppleScript(`
        tell application "${APP}"
          activate
          open location "https://maps.google.com/maps/dir/${from}/${to}"
        end tell
      `);
      return { directions: { from: args.from, to: args.to } };
    }),

    search_nearby: async (args) => act("search_nearby", async () => {
      const query = encodeURIComponent(args.query as string);
      const lat = args.lat as number | undefined;
      const lng = args.lng as number | undefined;
      const base = lat && lng
        ? `https://maps.google.com/maps/search/${query}/@${lat},${lng},14z`
        : `https://maps.google.com/maps/search/${query}`;
      await runAppleScript(`
        tell application "${APP}"
          activate
          open location "${base}"
        end tell
      `);
      return { searching: args.query };
    }),
  },
};

async function act(action: string, fn: () => Promise<unknown>): Promise<ActionResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return { status: "success", action: `app.google_maps.${action}`, target: "Google Maps", durationMs: Date.now() - start, result };
  } catch (e) {
    return { status: "failed", action: `app.google_maps.${action}`, target: "Google Maps", durationMs: Date.now() - start, error: (e as Error).message };
  }
}
