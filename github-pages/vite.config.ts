import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "github-pages",
  plugins: [react()],
  base: "./",
  build: {
    outDir: "../github-pages-dist",
    emptyOutDir: true,
  },
});
