import type { ArticleAudio, ArticleReading } from "../../src/article-core";

export const title = "Lire sans React";
export const html =
  "<p>Première phrase du test. Deuxième phrase du test.</p><h2>Suite</h2><p>Troisième phrase du test. Quatrième phrase du test.</p>";
const spoken = "Première phrase du test. Deuxième phrase du test. Suite. Troisième phrase du test. Quatrième phrase du test.";

export function fakeAudio(): ArticleAudio {
  let reading: ArticleReading = { state: "idle", position: 0, buffered: 8, duration: 8, rate: 1, text: null };
  let ticker: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ArticleReading>) => {
    reading = { ...reading, ...patch };
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => reading,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    toggle() {
      clearInterval(ticker);
      if (reading.state === "playing") return set({ state: "paused" });
      set({ state: "playing", text: spoken });
      ticker = setInterval(() => set({ position: Math.min(reading.position + 0.25 * reading.rate, 8) }), 250);
    },
    stop() {
      clearInterval(ticker);
      set({ state: "idle", position: 0, text: null });
    },
    seek: (position) => set({ position }),
    skip: (delta) => set({ position: Math.max(0, reading.position + delta) }),
    setRate: (rate) => set({ rate }),
  };
}
