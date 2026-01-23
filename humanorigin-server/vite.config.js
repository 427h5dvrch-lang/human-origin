import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  // ✅ CRITIQUE pour Tauri build (assets en relatif, évite page blanche)
  base: "./",

  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
  },

  envPrefix: ["VITE_", "TAURI_"],

  build: {
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
