# Articles

## Install

```sh
pnpm add @lalternative/editor
```

## Render

Compile on the server, display on the client:

```tsx
// server
import { renderArticleHtml } from "@lalternative/editor/article/server";

const html = await renderArticleHtml(markdown);
```

```tsx
// client
import { Article } from "@lalternative/editor/article";
import "@lalternative/editor/article.css";

<Article title={title} html={html} />;
```

Without a server step, pass `children` instead of `html` and render the prose yourself: the styles still apply. To show the prose alone, use `<ArticleProse html={html} />`.

> `ArticleProse` and `Article` inject `html` as it is. Give them what `renderArticleHtml` returned, nothing else.

## Vue, Svelte and plain JS

The props are the same everywhere. `audio` is the same object.

```vue
<script setup>
import { Article } from "@lalternative/editor/vue";
import "@lalternative/editor/article.css";
</script>

<template><Article :title="title" :html="html" :audio="audio" /></template>
```

```svelte
<script>
  import Article from "@lalternative/editor/svelte";
  import "@lalternative/editor/article.css";
</script>

<Article {title} {html} {audio} />
```

```js
import { mountArticle } from "@lalternative/editor/article/element";
import "@lalternative/editor/article.css";

const unmount = mountArticle(document.getElementById("app"), { title, html, audio });
```

## Markdown or MDX

| `format` | Use it for | Runs code? |
| --- | --- | --- |
| `"md"` (default) | Anything a person typed | Never |
| `"mdx"` | Sources your team wrote and reviewed | **Yes**, on your server |

```tsx
const html = await renderArticleHtml(source, {
  format: "mdx",
  components: { Figure },
});
```

GitHub-flavoured Markdown (tables, strikethrough, task lists, autolinks) is on in both. Links and images only keep safe URLs: `http(s):`, `mailto:`, `tel:`, relative paths and anchors. Images load lazily.

## Theme

Everything has a sensible fallback, so an unthemed page stays readable. Map what you care about:

```css
.lalt-article-page {
  --article-text: #1c1917;
  --article-muted: #57534e;
  --article-accent: #b45309;
  --article-rule: #e7e5e4;
  --article-surface: #fafaf9;
  --article-on-text: #ffffff;
  --article-font: "Source Serif 4", serif;
  --article-heading-font: "Inter", sans-serif;
  --article-mono: "JetBrains Mono", monospace;
  --article-size: 1.125rem;
  --article-title-size: 2.25rem;
  --article-radius: 8px;
}
```

`--article-text` is also the play button's background and `--article-on-text` its icon: set them as a pair.
