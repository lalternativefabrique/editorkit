<div align="center">

# ✍️ editorkit

**Write it. Publish it. Hear it read aloud.**

One package for the whole life of a text: the editor people write in,
the article people read, and the player that reads it to them.

[![npm](https://img.shields.io/npm/v/@lalternative/editor)](https://www.npmjs.com/package/@lalternative/editor)
[![license](https://img.shields.io/badge/license-MPL--2.0-blue)](LICENSE)

</div>

```tsx
<Article title="Bonjour" html={html} audio={audio} lang="fr" />
```

That line is a full article page: typeset prose, tables, images, an audio player, and each sentence lit up as it is read.

## Why

A text should not need a different implementation in every app. `@lalternative/editor` is the only one: every product renders the same article, with the same player, from the same code.

- **Plug and play.** Import a component and a stylesheet. Your theme is a handful of CSS variables.
- **Audio is optional.** No `audio` prop, no player. Nothing else changes.
- **Audio is an adapter.** The player knows a small contract, not a vendor. Bring any voice.
- **Safe by default.** Text from a person is compiled as Markdown: it never runs code, and `javascript:` links are dropped.
- **Multilingual.** French and English labels are built in; add yours or link the translations of a page.
- **Pay for what you use.** Showing articles needs no TipTap: its peers are optional.

## What's inside

React 18 or later is required, on the server too. `article.css` has no dependency.

| Entry point | What you get |
| --- | --- |
| `@lalternative/editor/article` | `Article`, `ArticleProse`, `ArticlePlayer` and the audio contract |
| `@lalternative/editor/article/server` | `renderArticleHtml`: Markdown or MDX to HTML, on the server |
| `@lalternative/editor/article.css` | Article and player styles |
| `@lalternative/editor` | The TipTap writing surface: screen, toolbars, slash commands, dictation, revisions |
| `@lalternative/editor/revisions` | Inline AI revision state, framework-free |
| `@lalternative/editor/native` | React Native toolbar and format sheet (no `Article` or player) |
| `@lalternative/editor/styles.css` | Editor styles |

## Articles

### Install

```sh
pnpm add @lalternative/editor
```

### Render

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

### Markdown or MDX

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

### Theme

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

## Audio

The player depends on one contract:

```ts
interface ArticleAudio {
  getSnapshot(): ArticleReading;
  subscribe(listener: () => void): () => void;
  toggle(): void;
  stop(): void;
  seek(seconds: number): void;
  skip(delta: number): void;
  setRate(rate: number): void;
}

interface ArticleReading {
  state: "unavailable" | "idle" | "loading" | "playing" | "paused";
  position: number;
  buffered: number;
  duration: number | null;
  rate: number;
  text?: string | null;
}
```

It is a plain object with no framework in it. `getSnapshot` returns the same object until something changes. With `state: "unavailable"` the player hides itself.

### With vvaves

```sh
pnpm add @lalternative/vvaves-sdk-react
```

Your server signs the reading, the browser plays it. The app key never reaches the page.

```tsx
import { readingAudio } from "@lalternative/vvaves-sdk-react";

const audio = useMemo(() => readingAudio(() => fetchSignedReading(id)), [id]);

<Article title={title} html={html} audio={audio} />;
```

### With anything else

Implement the object above and pass it as `audio`. Create it once per reading, with `useMemo` in React: the player stops it when it changes or unmounts.

### Read-along

Report the spoken `text` in the snapshot and the sentence being read lights up, for any adapter. It is drawn with the [CSS Custom Highlight API](https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API) under the name `lalt-article-reading`, styled by `article.css` from `--article-accent`. Outside `ArticlePlayer`, call `createReadAlong(audio, () => element)`.

### A player outside the article

`ArticlePlayer` works anywhere, as long as it gets a ref to the text:

```tsx
<ArticlePlayer audio={audio} article={ref} lang="en" />
```

## Languages

`lang` sets the page language and picks the player's labels. `"fr-CA"` falls back to `fr`, an unknown language to `en`.

```tsx
<Article
  lang="de"
  audioLabels={{
    region: "Audioversion dieses Artikels",
    listen: "Diesen Artikel anhören",
    play: "Anhören",
    pause: "Pause",
    progress: "Position in der Wiedergabe",
    reading: "wird gelesen…",
  }}
  translations={[
    { lang: "fr", label: "Français", href: "/fr/article" },
    { lang: "en", label: "English", href: "/en/article" },
  ]}
  html={html}
/>
```

## The editor

```sh
pnpm add @lalternative/editor @tiptap/core @tiptap/pm @tiptap/react @tiptap/starter-kit @tiptap/suggestion
```

`EditorScreen` is the page a writing surface sits in: a command bar, a title, one column of prose, and slots around them. You keep the TipTap instance and pick its extensions.

```tsx
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { EditorScreen } from "@lalternative/editor";
import "@lalternative/editor/styles.css";

function Page() {
  const editor = useEditor({ extensions: [StarterKit] });
  return (
    <EditorScreen title={title} onTitleChange={setTitle} saveState={saveState} actions={<ShareButton />}>
      <EditorContent editor={editor} />
    </EditorScreen>
  );
}
```

| Need | Reach for |
| --- | --- |
| Toolbar on selection | `SelectionToolbar`, `useSelectionToolbar` |
| `/` commands | `SlashCommands`, `SlashMenu`, `defaultSlashItems` |
| Inline AI revisions, accepted or rejected block by block | `useRevisions`, `RevisionPrompt`, `InlineSuggestions` |
| Sources for a passage | `SourcesPanel` |
| Voice dictation | `useDictation`, `DictationButton`; you provide `transcribe(blob)` |
| Export to Markdown | `docToMarkdown` |
| Turn a conversation into a document | `conversationToNodes`, `answerToNodes` |
| Phone keyboards | `useViewport`, `placeToolbar` |
| React Native | `EditorToolbar`, `FormatSheet`, `applyFormat` from `/native` |

No model and no backend are bundled: `Revise`, `FindSources` and `transcribe` are plain async functions you write.

## Develop

```sh
pnpm install
pnpm playground   # local playground
pnpm test
pnpm typecheck
pnpm build
```

## License

[MPL-2.0](LICENSE)
