# Audio

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

## With vvaves

```sh
pnpm add @lalternative/vvaves-sdk-react
```

Your server signs the reading, the browser plays it. The app key never reaches the page.

```tsx
import { readingAudio } from "@lalternative/vvaves-sdk-react";

const audio = useMemo(() => readingAudio(() => fetchSignedReading(id)), [id]);

<Article title={title} html={html} audio={audio} />;
```

## With anything else

Implement the object above and pass it as `audio`. Create it once per reading, with `useMemo` in React: the player stops it when it changes or unmounts.

## Read-along

Report the spoken `text` in the snapshot and the sentence being read lights up, for any adapter. It is drawn with the [CSS Custom Highlight API](https://developer.mozilla.org/docs/Web/API/CSS_Custom_Highlight_API) under the name `lalt-article-reading`, styled by `article.css` from `--article-accent`. Outside `ArticlePlayer`, call `createReadAlong(audio, () => element)`.

## A player outside the article

`ArticlePlayer` works anywhere, as long as it gets a ref to the text:

```tsx
<ArticlePlayer audio={audio} article={ref} lang="en" />
```
