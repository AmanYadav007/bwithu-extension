import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative base so the build can be served from any static path.
  base: "./",
  server: {
    port: 3001,
  },
});
