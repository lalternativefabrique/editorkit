import { defineComponent, h, type PropType } from "vue";

import "./article-element";
import type { ArticleAudio, ArticleAudioLabels, ArticleTranslation } from "./article-core";

export * from "./article-core";

export const Article = defineComponent({
  name: "LaltArticle",
  props: {
    title: String,
    html: String,
    audio: Object as PropType<ArticleAudio>,
    audioLabels: Object as PropType<ArticleAudioLabels>,
    lang: { type: String, default: "fr" },
    translations: Array as PropType<ArticleTranslation[]>,
  },
  setup(props, { slots }) {
    return () =>
      h("article", { lang: props.lang, class: "lalt-article-page" }, [
        props.title ? h("h1", { class: "lalt-article-title" }, props.title) : null,
        props.translations?.length
          ? h(
              "nav",
              { class: "lalt-article-translations" },
              props.translations.map((t) => h("a", { key: t.lang, href: t.href, lang: t.lang, hreflang: t.lang }, t.label)),
            )
          : null,
        props.audio ? h("lalt-article-player", { ".audio": props.audio, ".labels": props.audioLabels, lang: props.lang }) : null,
        props.html === undefined ? h("div", { class: "lalt-article" }, slots.default?.()) : h("div", { class: "lalt-article", innerHTML: props.html }),
      ]);
  },
});
