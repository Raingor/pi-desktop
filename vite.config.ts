import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri Vite config — no Electron, no server middleware.
// All backend logic is handled by Rust Tauri Commands.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  server: {
    port: 5179,
    strictPort: true,
    watch: {
      // Ignore browser-tool profile dir created inside the project
      ignored: ["**/.pi/**", "**/node_modules/**", "**/target/**"],
    },
  },
});
