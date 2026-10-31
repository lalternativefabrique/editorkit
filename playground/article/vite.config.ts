import { resolve } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  plugins: [svelte()],
  resolve: { alias: { "@lalternative/editor/article/element": resolve(__dirname, "../../src/article-element.ts") } },
  optimizeDeps: { exclude: ["svelte"] },
  server: { port: 5199, host: "0.0.0.0" },
});
