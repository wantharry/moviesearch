import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Source lives in web/, but builds land in public/ — the same folder server.js already
// serves as static files, so nothing about the Express side needs to change.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
