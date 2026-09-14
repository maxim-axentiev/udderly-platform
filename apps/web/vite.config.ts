import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const appRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  server: {
    port: 3000,
    host: "127.0.0.1",
    strictPort: true,
  },
  resolve: {
    alias: {
      "@udderly/shared": path.resolve(
        appRoot,
        "../../packages/shared/src/index.ts",
      ),
    },
  },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
