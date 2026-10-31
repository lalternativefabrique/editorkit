<script>
  import "@lalternative/editor/article/element";

  let { title, html, audio, audioLabels, lang = "fr", translations, children } = $props();
</script>

<article {lang} class="lalt-article-page">
  {#if title}<h1 class="lalt-article-title">{title}</h1>{/if}
  {#if translations?.length}
    <nav class="lalt-article-translations">
      {#each translations as t (t.lang)}<a href={t.href} lang={t.lang} hreflang={t.lang}>{t.label}</a>{/each}
    </nav>
  {/if}
  {#if audio}<lalt-article-player {audio} labels={audioLabels} {lang}></lalt-article-player>{/if}
  {#if html === undefined}
    <div class="lalt-article">{@render children?.()}</div>
  {:else}
    <div class="lalt-article">{@html html}</div>
  {/if}
</article>
