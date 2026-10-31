import { useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";

import { createReadAlong } from "./read-along";

export { createReadAlong } from "./read-along";
export type { ReadAlongOptions, ReadAlongSource } from "./read-along";

import { labelsFor, nextReadingSpeed, formatReadingTime, type ArticleAudio, type ArticleAudioLabels, type ArticleTranslation } from "./article-core";

export * from "./article-core";

export function ArticlePlayer({
  audio,
  article,
  lang = "fr",
  labels = labelsFor(lang),
}: {
  audio: ArticleAudio;
  article: RefObject<HTMLElement | null>;
  lang?: string;
  labels?: ArticleAudioLabels;
}) {
  const reading = useSyncExternalStore(audio.subscribe, audio.getSnapshot, audio.getSnapshot);
  useEffect(() => {
    const detach = createReadAlong(audio, () => article.current);
    return () => {
      detach();
      audio.stop();
    };
  }, [audio, article]);
  if (reading.state === "unavailable") return null;
  const playing = reading.state === "playing";
  const active = reading.state !== "idle";
  return (
    <section className="lalt-article-player" aria-label={labels.region}>
      <p className="lalt-article-player-title">{labels.listen}</p>
      <div className="lalt-article-player-main">
        <button type="button" className="lalt-article-play" aria-label={playing ? labels.pause : labels.play} onClick={audio.toggle}>
          {reading.state === "loading" ? <span aria-hidden="true" className="lalt-article-spinner" /> : playing ? "❚❚" : "▶"}
        </button>
        <div className="lalt-article-track">
          <input
            type="range"
            aria-label={labels.progress}
            min={0}
            max={Math.max(reading.duration ?? reading.buffered, 0.1)}
            step={0.1}
            value={reading.position}
            disabled={!active}
            onChange={(e) => audio.seek(Number(e.target.value))}
          />
          <div className="lalt-article-times">
            <span>{formatReadingTime(reading.position)}</span>
            <span>{reading.duration ? formatReadingTime(reading.duration) : active ? labels.reading : ""}</span>
          </div>
        </div>
      </div>
      {active && (
        <div className="lalt-article-controls">
          <button type="button" onClick={() => audio.skip(-15)}>
            −15 s
          </button>
          <button type="button" onClick={() => audio.skip(15)}>
            +15 s
          </button>
          <button type="button" onClick={() => audio.setRate(nextReadingSpeed(reading.rate))}>
            ×{reading.rate}
          </button>
        </div>
      )}
    </section>
  );
}

export function ArticleProse({ html, className }: { html: string; className?: string }) {
  return <div className={className ? `lalt-article ${className}` : "lalt-article"} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Article({
  title,
  html,
  children,
  audio,
  audioLabels,
  lang = "fr",
  translations,
  className,
}: {
  title?: ReactNode;
  html?: string;
  children?: ReactNode;
  audio?: ArticleAudio;
  audioLabels?: ArticleAudioLabels;
  lang?: string;
  translations?: ArticleTranslation[];
  className?: string;
}) {
  const article = useRef<HTMLElement>(null);
  return (
    <article ref={article} lang={lang} className={className ? `lalt-article-page ${className}` : "lalt-article-page"}>
      {title && <h1 className="lalt-article-title">{title}</h1>}
      {translations && translations.length > 0 && (
        <nav className="lalt-article-translations">
          {translations.map((t) => (
            <a key={t.lang} href={t.href} lang={t.lang} hrefLang={t.lang}>
              {t.label}
            </a>
          ))}
        </nav>
      )}
      {audio && <ArticlePlayer audio={audio} article={article} lang={lang} labels={audioLabels} />}
      {html === undefined ? <div className="lalt-article">{children}</div> : <ArticleProse html={html} />}
    </article>
  );
}
