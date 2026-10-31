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

export function labelsFor(lang: string): ArticleAudioLabels {
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

