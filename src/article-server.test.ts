import { describe, expect, it } from "vitest";
import { renderArticleHtml, safeUrl } from "./article-server";

describe("renderArticleHtml", () => {
  it("keeps the structure of a note", async () => {
    const html = await renderArticleHtml("## Angle\n\n- un\n- deux\n\n![vue](https://x.fr/a.png)");
    expect(html).toContain("<h2>Angle</h2>");
    expect(html).toContain("<li>un</li>");
    expect(html).toContain('src="https://x.fr/a.png"');
  });

  it("reads tables", async () => {
    expect(await renderArticleHtml("|a|\n|-|\n|b|")).toContain("<table>");
  });

  it("never runs what a person wrote", async () => {
    const html = await renderArticleHtml("{process.exit(1)}\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror=\"");
    expect(html).not.toContain("<img");
  });

  it("drops script links", async () => {
    const html = await renderArticleHtml("[x](javascript:alert(1)) ![y](data:text/html,z)");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:");
  });
});

describe("safeUrl", () => {
  it("sees through control characters", () => {
    expect(safeUrl("java\tscript:alert(1)")).toBeUndefined();
    expect(safeUrl("//evil.fr")).toBeUndefined();
    expect(safeUrl("/a.png")).toBe("/a.png");
  });
});
