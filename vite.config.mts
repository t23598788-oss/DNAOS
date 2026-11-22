import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { responseStoreAdapter } from "@vinext/cloudflare/cache/response-store-adapter";
import "./cloudflare/fsevents-stub.ts";

export default defineConfig({
  resolve: {
    // fsevents is an optional macOS file watcher dependency. It is never used
    // by deployed Workers, and its native binary cannot be bundled by workerd.
    alias: [
      {
        find: /^fsevents$/,
        replacement: new URL("./cloudflare/fsevents-stub.ts", import.meta.url).pathname,
      },
    ],
  },
  plugins: [
    vinext({
      cache: responseStoreAdapter({ mode: "self-contained" }),
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
