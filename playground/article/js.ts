import "../../src/article.css";
import { mountArticle } from "../../src/article-element";
import { fakeAudio, html, title } from "./fake";

mountArticle(document.getElementById("app")!, { title, html, audio: fakeAudio() });
