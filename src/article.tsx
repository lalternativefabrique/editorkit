import { useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";

import { createReadAlong } from "./read-along";

export { createReadAlong } from "./read-along";
export type { ReadAlongOptions, ReadAlongSource } from "./read-along";

export type ArticleReadingState = "unavailable" | "idle" | "loading" | "playing" | "paused";

export interface ArticleReading {
  state: ArticleReadingState;
  position: number;
  buffered: number;
  duration: number | null;
  rate: number;
  text?: string | null;
}

export interface ArticleAudio {
  getSnapshot: () => ArticleReading;
  subscribe: (listener: () => void) => () => void;
  toggle: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  skip: (delta: number) => void;
  setRate: (rate: number) => void;
}

export interface ArticleAudioLabels {
  region: string;
  listen: string;
  play: string;
  pause: string;
  progress: string;
  reading: string;
}

export const articleAudioLabels: Record<string, ArticleAudioLabels> = {
  fr: {
    region: "Lecture audio de l’article",
    listen: "Écouter cet article",
    play: "Écouter",
    pause: "Pause",
    progress: "Position dans la lecture",
    reading: "lecture en cours…",
  },
  en: {
    region: "Audio version of this article",
    listen: "Listen to this article",
    play: "Listen",
    pause: "Pause",
    progress: "Position in the reading",
    reading: "reading…",
  },
};

export interface ArticleTranslation {
  lang: string;
  label: string;
  href: string;
}

function labelsFor(lang: string): ArticleAudioLabels {
  return articleAudioLabels[lang.split("-")[0].toLowerCase()] ?? articleAudioLabels.en;
}

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

export function formatReadingTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function nextReadingSpeed(rate: number): number {
  return SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length];
}

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
