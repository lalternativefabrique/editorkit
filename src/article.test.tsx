import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Article, formatReadingTime, nextReadingSpeed, type ArticleAudio, type ArticleReading } from "./article";

const reading = (over: Partial<ArticleReading>): ArticleAudio => ({
  useReading: () => ({ state: "idle", toggle() {}, stop() {}, position: 0, duration: null, seek() {}, rate: 1, setRate() {}, ...over }),
});

describe("Article", () => {
  it("has no player without an adapter", () => {
    expect(renderToStaticMarkup(<Article title="T" html="<p>x</p>" />)).not.toContain("button");
  });

  it("offers listening through the adapter", () => {
    expect(renderToStaticMarkup(<Article html="<p>x</p>" audio={reading({})} />)).toContain("Écouter");
  });

  it("hides the player when the adapter cannot read", () => {
    expect(renderToStaticMarkup(<Article html="<p>x</p>" audio={reading({ state: "unavailable" })} />)).not.toContain("button");
  });

  it("shows the running reading", () => {
    const html = renderToStaticMarkup(<Article html="<p>x</p>" audio={reading({ state: "playing", position: 65, duration: 120 })} />);
    expect(html).toContain("1:05");
    expect(html).toContain("Pause");
  });
});

describe("reading controls", () => {
  it("formats and cycles", () => {
    expect(formatReadingTime(9)).toBe("0:09");
    expect(nextReadingSpeed(0.75)).toBe(1);
  });
});
