import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "../bundle",
    emptyOutDir: true,
    target: "es2020",
    rollupOptions: {
      input: {
        main: "index.html",
        advanced: "advanced.html",
        roundtrip: "roundtrip.html",
        convert: "convert.html",
      },
    },
  },
  worker: {
    format: "es",
  },
});
