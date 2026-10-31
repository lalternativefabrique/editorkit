<script>
  import Article from "../../src/svelte/Article.svelte";
  import { fakeAudio, html, title } from "./fake";

  const audio = fakeAudio();
</script>

<Article {title} {html} {audio} />
