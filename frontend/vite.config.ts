import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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


