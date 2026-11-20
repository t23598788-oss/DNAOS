/** Vite and Cloudflare plugin configuration for building the stock-ingest Worker. */
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [cloudflare()],
});
