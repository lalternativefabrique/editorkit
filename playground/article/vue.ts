import { createApp, h } from "vue";
import "../../src/article.css";
import { Article } from "../../src/article-vue";
import { fakeAudio, html, title } from "./fake";

const audio = fakeAudio();
createApp({ render: () => h(Article, { title, html, audio }) }).mount("#app");
