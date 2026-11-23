import { describe, expect, it } from "vitest";

import { DEFAULT_PAGE_SETUP, pageSetupOf, pageStyle } from "./print";

describe("printing a document", () => {
  it("sets the paper, the margins, the title on top and the page numbers below", () => {
    const style = pageStyle(DEFAULT_PAGE_SETUP, "Budget « 2027 »");
    expect(style).toContain("size: A4 portrait");
    expect(style).toContain("margin: 20mm");
    expect(style).toContain('@top-left { content: "Budget « 2027 »"');
    expect(style).toContain('@bottom-right { content: counter(page) " / " counter(pages)');
  });

  it("leaves out what the setup turns off, and keeps a title from breaking the rule", () => {
    const style = pageStyle({ ...DEFAULT_PAGE_SETUP, orientation: "landscape", margins: "narrow", numbers: false }, 'Dit "oui"');
    expect(style).toContain("size: A4 landscape");
    expect(style).toContain("margin: 12mm");
    expect(style).toContain('content: "Dit \\"oui\\""');
    expect(style).not.toContain("counter(page)");
    expect(pageStyle({ ...DEFAULT_PAGE_SETUP, header: false }, "Titre")).not.toContain("@top-left");
  });

  it("reads a document's setup over the defaults", () => {
    expect(pageSetupOf({ attrs: { page: { margins: "wide" } } })).toEqual({ ...DEFAULT_PAGE_SETUP, margins: "wide" });
    expect(pageSetupOf({ attrs: { page: null } })).toEqual(DEFAULT_PAGE_SETUP);
  });
});
