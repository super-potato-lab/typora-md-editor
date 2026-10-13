import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error process types are provided by the Tauri CLI at dev time
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Listen on every local interface so both 127.0.0.1 and ::1 can reach the dev server.
    host: host || true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
