import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// ─── Pi Config API Plugin ───────────────────────────────

function piApiPlugin(): Plugin {
  return {
    name: "pi-api",
    configureServer(server) {
      // Lazy-load the server-side module (Node.js only). The route table is
      // shared with the packaged Electron app via server/api-routes.ts.
      const { createPiApiMiddleware } = require("./server/api-routes");
      server.middlewares.use(createPiApiMiddleware());
    },
  };
}

export default defineConfig({
  // Relative base so Electron can loadFile() the built HTML from disk —
  // absolute "/assets/..." URLs would resolve to the filesystem root.
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    piApiPlugin(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5179,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        // Menu-bar popup (used by the Electron tray app)
        popup: path.resolve(__dirname, "electron/popup.html"),
      },
    },
  },
});
