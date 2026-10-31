<div align="center">

<img src="https://raw.githubusercontent.com/lalternativefabrique/editorkit/main/docs/assets/banner.png" alt="editorkit: write, publish, listen" width="100%">

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

## Quick start

```sh
pnpm add @lalternative/editor
```

```tsx
import { Article } from "@lalternative/editor/article";
import "@lalternative/editor/article.css";

<Article title={title} html={html} audio={audio} />;
```

Also for [Vue, Svelte and plain JS](docs/articles.md#vue-svelte-and-plain-js).

## Why

- **One implementation.** Every app renders the same article and the same player.
- **Audio is optional,** and goes through an adapter, not a vendor.
- **Safe by default.** Text from a person never runs code.
- **Multilingual** out of the box.

## Docs

- [Articles](docs/articles.md): render, Markdown or MDX, theme, frameworks
- [Audio](docs/audio.md): the contract, vvaves, read-along
- [Languages](docs/languages.md)
- [Editor](docs/editor.md): the TipTap writing surface
- [Entry points](docs/entry-points.md)

## Develop

```sh
pnpm install
sklp dev stack    # editor on :5198, article in JS, Vue and Svelte on :5199
pnpm test
pnpm typecheck
pnpm build
```


## License

[MPL-2.0](LICENSE)
