import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    chunkSizeWarningLimit: 5000,
    // PDF.js 的 worker 由主线程显式指定 workerSrc（同源 /api/lab-pdf-viewer/ 托管），
    // 这里保留 pdf.worker.mjs 作为独立产物供宿主通过 workerSrc 加载。
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  }
});
