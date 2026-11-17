import { defineConfig } from "vite";

/* 仅构建文档布局 Worker（ESM 单文件），供正式前端 UMD 主线程加载：
   产物：frontend/vendor/univer/docs-layout-worker.js */
export default defineConfig({
  build: {
    outDir: "D:/project/hourglass-univer/frontend/vendor/univer",
    emptyOutDir: false,
    target: "es2020",
    lib: {
      entry: "src/worker.js",
      formats: ["es"],
      fileName: () => "docs-layout-worker.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
