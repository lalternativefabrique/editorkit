import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Article, formatReadingTime, nextReadingSpeed, type ArticleAudio, type ArticleReading } from "./article";

const reading = (over: Partial<ArticleReading>): ArticleAudio => {
  const snapshot: ArticleReading = { state: "idle", position: 0, buffered: 0, duration: null, rate: 1, ...over };
  return { getSnapshot: () => snapshot, subscribe: () => () => {}, toggle() {}, stop() {}, seek() {}, skip() {}, setRate() {} };
};

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
    expect(html).toContain("+15 s");
  });
});

describe("languages", () => {
  it("speaks the article's language", () => {
    const html = renderToStaticMarkup(<Article lang="en-GB" html="<p>x</p>" audio={reading({})} />);
    expect(html).toContain('lang="en-GB"');
    expect(html).toContain("Listen to this article");
  });

  it("links the translations", () => {
    const html = renderToStaticMarkup(<Article html="<p>x</p>" translations={[{ lang: "en", label: "English", href: "/en/a" }]} />);
    expect(html).toContain('hrefLang="en"');
  });
});

describe("reading controls", () => {
  it("formats and cycles", () => {
    expect(formatReadingTime(9)).toBe("0:09");
    expect(nextReadingSpeed(1.5)).toBe(2);
  });
});
