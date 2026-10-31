import { useEffect, type ReactNode } from "react";

export type ArticleReadingState = "unavailable" | "idle" | "loading" | "playing" | "paused";

export interface ArticleReading {
  state: ArticleReadingState;
  toggle: () => void;
  stop: () => void;
  position: number;
  duration: number | null;
  seek: (seconds: number) => void;
  rate: number;
  setRate: (rate: number) => void;
}

export interface ArticleAudio {
  useReading: () => ArticleReading;
}

export interface ArticleAudioLabels {
  listen: string;
  loading: string;
  pause: string;
  resume: string;
  progress: string;
  speed: string;
}

export const defaultArticleAudioLabels: ArticleAudioLabels = {
  listen: "Écouter l’article",
  loading: "Préparation de la lecture…",
  pause: "Pause",
  resume: "Reprendre",
  progress: "Position dans la lecture",
  speed: "Vitesse de lecture",
};

const SPEEDS = [1, 1.25, 1.5, 0.75];

export function formatReadingTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function nextReadingSpeed(rate: number): number {
  return SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length];
}

function ArticlePlayer({ audio, labels }: { audio: ArticleAudio; labels: ArticleAudioLabels }) {
  const reading = audio.useReading();
  const { stop } = reading;
  useEffect(() => () => stop(), [stop]);
  if (reading.state === "unavailable") return null;
  if (reading.state === "idle" || reading.state === "loading") {
    return (
      <button type="button" className="lalt-article-listen" disabled={reading.state === "loading"} onClick={reading.toggle}>
        {reading.state === "loading" ? labels.loading : `▶ ${labels.listen}`}
      </button>
    );
  }
  const playing = reading.state === "playing";
  return (
    <div className="lalt-article-player">
      <button type="button" aria-label={playing ? labels.pause : labels.resume} onClick={reading.toggle}>
        {playing ? "❚❚" : "▶"}
      </button>
      <input
        type="range"
        aria-label={labels.progress}
        min={0}
        max={reading.duration ?? 0}
        step={1}
        value={reading.position}
        disabled={reading.duration === null}
        onChange={(e) => reading.seek(Number(e.target.value))}
      />
      <span>{formatReadingTime(reading.position)}</span>
      <button type="button" aria-label={labels.speed} onClick={() => reading.setRate(nextReadingSpeed(reading.rate))}>
        {String(reading.rate).replace(".", ",")}×
      </button>
    </div>
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
  audioLabels = defaultArticleAudioLabels,
  className,
}: {
  title?: ReactNode;
  html?: string;
  children?: ReactNode;
  audio?: ArticleAudio;
  audioLabels?: ArticleAudioLabels;
  className?: string;
}) {
  return (
    <article className={className ? `lalt-article-page ${className}` : "lalt-article-page"}>
      {title && <h1 className="lalt-article-title">{title}</h1>}
      {audio && <ArticlePlayer audio={audio} labels={audioLabels} />}
      {html === undefined ? <div className="lalt-article">{children}</div> : <ArticleProse html={html} />}
    </article>
  );
}
