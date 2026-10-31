# Entry points

React is only required by the React entries and by `renderArticleHtml` on the server. `article.css` has no dependency.

| Entry point | What you get |
| --- | --- |
| `@lalternative/editor/article` | `Article`, `ArticleProse`, `ArticlePlayer` and the audio contract |
| `@lalternative/editor/vue` | `Article` for Vue 3 |
| `@lalternative/editor/svelte` | `Article` for Svelte 5 |
| `@lalternative/editor/article/element` | `<lalt-article-player>` and `mountArticle` for plain JS, built on Lit |
| `@lalternative/editor/article/server` | `renderArticleHtml`: Markdown or MDX to HTML, on the server |
| `@lalternative/editor/article.css` | Article and player styles |
| `@lalternative/editor` | The TipTap writing surface: screen, toolbars, slash commands, dictation, revisions |
| `@lalternative/editor/revisions` | Inline AI revision state, framework-free |
| `@lalternative/editor/native` | React Native toolbar and format sheet (no `Article` or player) |
| `@lalternative/editor/styles.css` | Editor styles |
