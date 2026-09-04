import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      events: fileURLToPath(new URL("./node_modules/events/events.js", import.meta.url))
    }
  },
  build: { chunkSizeWarningLimit: 20000 }
});
