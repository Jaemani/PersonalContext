import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  build: {
    outDir: path.resolve(root, "../../dist/setup-ui"),
    emptyOutDir: false,
  },
  server: {
    host: "127.0.0.1",
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
