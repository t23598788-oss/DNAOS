/** Vite and Cloudflare plugin configuration for building the DNA OS Gateway Worker. */
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({ plugins: [cloudflare()] });
