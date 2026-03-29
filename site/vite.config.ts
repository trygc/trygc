import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: path.join(__dirname, "spa"),
  base: "/react-build/",
  build: {
    outDir: path.join(__dirname, "react-build"),
    emptyOutDir: true,
    sourcemap: false,
    minify: "esbuild",
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom/client"],
        },
      },
    },
  },
});
