import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      strategies: "generateSW",
      workbox: {
        cleanupOutdatedCaches: true
      },
      manifest: {
        name: "MediVoice AI",
        short_name: "MediVoice",
        theme_color: "#3b82f6",
        background_color: "#ffffff",
        display: "standalone",
        icons: [
          {
            src: "/icons/medivoice-192.svg",
            sizes: "192x192",
            type: "image/svg+xml"
          },
          {
            src: "/icons/medivoice-512.svg",
            sizes: "512x512",
            type: "image/svg+xml"
          }
        ]
      }
    })
  ],
  resolve: {
    // PouchDB depends on Node's `events` module. Vite doesn't polyfill Node built-ins by default,
    // so we alias to the browser-compatible npm package.
    alias: {
      events: "events"
    }
  },
  optimizeDeps: {
    include: ["events", "pouchdb-browser", "pouchdb-find"]
  },
  server: {
    port: 5173
  }
});


