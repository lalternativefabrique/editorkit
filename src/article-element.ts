import { html, LitElement, nothing } from "lit";

import { formatReadingTime, labelsFor, nextReadingSpeed, type ArticleAudio, type ArticleAudioLabels, type ArticleTranslation } from "./article-core";
import { createReadAlong } from "./read-along";

export * from "./article-core";
export { createReadAlong } from "./read-along";

export class LaltArticlePlayer extends LitElement {
  static properties = {
    audio: { attribute: false },
    article: { attribute: false },
    labels: { attribute: false },
    lang: { type: String },
  };

  declare audio: ArticleAudio | undefined;
  declare article: HTMLElement | undefined;
  declare labels: ArticleAudioLabels | undefined;

  private detach: (() => void) | null = null;

  protected createRenderRoot() {
    return this;
  }

  private attach() {
    const audio = this.audio;
    if (!audio || !this.isConnected) return;
    const unsubscribe = audio.subscribe(() => this.requestUpdate());
    const stopReadAlong = createReadAlong(audio, () => this.article ?? this.closest("article"));
    this.detach = () => {
      unsubscribe();
      stopReadAlong();
      audio.stop();
    };
  }

  private release() {
    this.detach?.();
    this.detach = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this.attach();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.release();
  }

  protected willUpdate(changed: Map<string, unknown>) {
    if (!changed.has("audio")) return;
    this.release();
    this.attach();
  }

  protected render() {
    const audio = this.audio;
    if (!audio) return nothing;
    const reading = audio.getSnapshot();
    if (reading.state === "unavailable") return nothing;
    const labels = this.labels ?? labelsFor(this.lang || "fr");
    const playing = reading.state === "playing";
    const active = reading.state !== "idle";
    return html`
      <section class="lalt-article-player" aria-label=${labels.region}>
        <p class="lalt-article-player-title">${labels.listen}</p>
        <div class="lalt-article-player-main">
          <button type="button" class="lalt-article-play" aria-label=${playing ? labels.pause : labels.play} @click=${audio.toggle}>
            ${reading.state === "loading" ? html`<span aria-hidden="true" class="lalt-article-spinner"></span>` : playing ? "❚❚" : "▶"}
          </button>
          <div class="lalt-article-track">
            <input
              type="range"
              aria-label=${labels.progress}
              min="0"
              max=${Math.max(reading.duration ?? reading.buffered, 0.1)}
              step="0.1"
              .value=${String(reading.position)}
              ?disabled=${!active}
              @input=${(e: Event) => audio.seek(Number((e.target as HTMLInputElement).value))}
            />
            <div class="lalt-article-times">
              <span>${formatReadingTime(reading.position)}</span>
              <span>${reading.duration ? formatReadingTime(reading.duration) : active ? labels.reading : ""}</span>
            </div>
          </div>
        </div>
        ${active
          ? html`<div class="lalt-article-controls">
              <button type="button" @click=${() => audio.skip(-15)}>−15 s</button>
              <button type="button" @click=${() => audio.skip(15)}>+15 s</button>
              <button type="button" @click=${() => audio.setRate(nextReadingSpeed(reading.rate))}>×${reading.rate}</button>
            </div>`
          : nothing}
      </section>
    `;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("lalt-article-player")) {
  customElements.define("lalt-article-player", LaltArticlePlayer);
}

declare global {
  interface HTMLElementTagNameMap {
    "lalt-article-player": LaltArticlePlayer;
  }
}

export interface ArticleMountOptions {
  title?: string;
  html: string;
  audio?: ArticleAudio;
  audioLabels?: ArticleAudioLabels;
  lang?: string;
  translations?: ArticleTranslation[];
  className?: string;
}

export function mountArticle(target: HTMLElement, { title, html: body, audio, audioLabels, lang = "fr", translations, className }: ArticleMountOptions): () => void {
  const article = document.createElement("article");
  article.lang = lang;
  article.className = className ? `lalt-article-page ${className}` : "lalt-article-page";
  if (title) {
    const heading = article.appendChild(document.createElement("h1"));
    heading.className = "lalt-article-title";
    heading.textContent = title;
  }
  if (translations?.length) {
    const nav = article.appendChild(document.createElement("nav"));
    nav.className = "lalt-article-translations";
    for (const t of translations) {
      const link = nav.appendChild(document.createElement("a"));
      link.href = t.href;
      link.lang = t.lang;
      link.hreflang = t.lang;
      link.textContent = t.label;
    }
  }
  if (audio) {
    const player = article.appendChild(document.createElement("lalt-article-player"));
    player.lang = lang;
    player.labels = audioLabels;
    player.audio = audio;
  }
  const prose = article.appendChild(document.createElement("div"));
  prose.className = "lalt-article";
  prose.innerHTML = body;
  target.appendChild(article);
  return () => article.remove();
}
