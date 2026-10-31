import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    revisions: "src/revisions.ts",
    native: "src/native.ts",
    article: "src/article.tsx",
    "article-element": "src/article-element.ts",
    "article-vue": "src/article-vue.ts",
    "article-server": "src/article-server.tsx",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    "vue",
    "react",
    "react-dom",
    "@tiptap/core",
    "@tiptap/pm",
    "@tiptap/react",
    "@tiptap/starter-kit",
    "@tiptap/suggestion",
    "react-native",
  ],
  async onSuccess() {
    const { copyFile, mkdir } = await import("node:fs/promises");
    await copyFile("src/editor.css", "dist/editor.css");
    await copyFile("src/article.css", "dist/article.css");
    await mkdir("dist/svelte", { recursive: true });
    await copyFile("src/svelte/Article.svelte", "dist/svelte/Article.svelte");
  },
});
