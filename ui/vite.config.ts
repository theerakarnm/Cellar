import { defineConfig } from "vite";

// 8787 is wrangler's default port. `bun run dev:api` listens there (see scripts/dev.ts).
const api = "http://127.0.0.1:8787";

export default defineConfig({
  build: { outDir: "../dist/ui", emptyOutDir: true },
  server: { port: 5173, strictPort: true, proxy: { "/api": api, "/internal": api } },
});
