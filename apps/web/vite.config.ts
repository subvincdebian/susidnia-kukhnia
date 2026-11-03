import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  base: mode === "pages" ? process.env.DELIVERY_BASE_PATH ?? "/susidnia-kukhnia/" : "/",
  plugins: [react()],
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  worker: { format: "es" },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: true } },
  },
  build: { target: "es2022", sourcemap: false },
}));
