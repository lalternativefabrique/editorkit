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
    kertas: "src/kertas/index.ts",
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
    await copyFile("src/kertas/kertas.css", "dist/kertas.css");
    await copyFile("src/kertas/surface/writing.css", "dist/writing.css");
    await mkdir("dist/kertas", { recursive: true });
    await copyFile("kertas/dist/kertas.wasm", "dist/kertas/kertas.wasm");
    await copyFile("LICENSE-kertas.md", "dist/kertas/LICENSE.md");
    await copyFile("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", "dist/kertas/pdf.worker.min.mjs");
    await copyFile("node_modules/pdfjs-dist/web/pdf_viewer.css", "dist/kertas/pdf_viewer.css");
    for (const lang of ["fr", "en"]) {
      await copyFile(`node_modules/dictionary-${lang}/index.aff`, `dist/kertas/dictionary-${lang}.aff`);
      await copyFile(`node_modules/dictionary-${lang}/index.dic`, `dist/kertas/dictionary-${lang}.dic`);
    }
  },
});
