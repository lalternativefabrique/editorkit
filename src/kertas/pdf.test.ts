// @vitest-environment happy-dom
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { BlockIds } from "./blockIds";
import { kertasFrom } from "./engine";
import { OPEN_WEB_EVENT, insertWebExcerpt, openPdfAt, pdfExtensions } from "./pdf";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const pdf = { type: "pdf", attrs: { id: "b-1", src: "", name: "dutta.pdf", view: "line", page: 1 } };
const excerpt = (quote: string, page: number) => ({
  type: "excerpt",
  attrs: { of: "b-1", name: "dutta.pdf", page, quote, color: "#fde68a", rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }] },
});

function open(content: JSONContent[]): Editor {
  editor = new Editor({ extensions: [StarterKit.configure({ link: { openOnClick: false } }), BlockIds, ...pdfExtensions()], content: { type: "doc", content } });
  return editor;
}

describe("a PDF kept in a note", () => {
  it("keeps its excerpts, their pages and boxes, through the stored document", () => {
    const e = open([pdf, excerpt("Observation is hard.", 3), { type: "paragraph" }]);
    const again = open(e.getJSON().content ?? []);
    const [, kept] = again.getJSON().content ?? [];
    expect(kept.type).toBe("excerpt");
    expect(kept.attrs).toMatchObject({ of: "b-1", page: 3, quote: "Observation is hard.", rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }] });
  });

  it("keeps its excerpts through the note's HTML as well", () => {
    const e = open([pdf, excerpt("Observation is hard.", 3)]);
    const html = e.getHTML();
    expect(html).toContain('data-source="b-1" data-source-page="3"');
    const again = open([]);
    again.commands.setContent(html);
    expect(again.getJSON().content?.find((n) => n.type === "excerpt")?.attrs).toMatchObject({ page: 3, rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }] });
  });

  it("keeps a figure taken from the PDF, its image and its frame, through the note's HTML", () => {
    const figure = { type: "excerpt", attrs: { of: "b-1", name: "dutta.pdf", page: 4, quote: "", color: "#bfdbfe", kind: "figure", image: "data:image/png;base64,AA", rects: [{ x: 0.1, y: 0.3, w: 0.6, h: 0.2 }] } };
    const e = open([pdf, figure]);
    expect(e.view.dom.querySelector("img.kertas-excerpt-figure")?.getAttribute("src")).toBe("data:image/png;base64,AA");
    const again = open([]);
    again.commands.setContent(e.getHTML());
    expect(again.getJSON().content?.find((n) => n.type === "excerpt")?.attrs).toMatchObject({ kind: "figure", image: "data:image/png;base64,AA", page: 4, rects: [{ x: 0.1, y: 0.3, w: 0.6, h: 0.2 }] });
  });

  it("keeps a passage of a web page and reopens the page at it", () => {
    const e = open([{ type: "paragraph", content: [{ type: "text", text: "Lu ce matin" }] }]);
    insertWebExcerpt(e, { url: "https://www.lemonde.fr/a", title: "", quote: "Les équipes se cloisonnent." });
    const kept = e.getJSON().content?.find((n) => n.type === "excerpt");
    expect(kept?.attrs).toMatchObject({ kind: "web", url: "https://www.lemonde.fr/a", name: "lemonde.fr", quote: "Les équipes se cloisonnent." });
    const opened: unknown[] = [];
    const listen = (event: Event) => {
      event.preventDefault();
      opened.push((event as CustomEvent).detail);
    };
    window.addEventListener(OPEN_WEB_EVENT, listen);
    (e.view.dom.querySelector(".kertas-excerpt-source") as HTMLElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    window.removeEventListener(OPEN_WEB_EVENT, listen);
    expect(opened).toEqual([{ url: "https://www.lemonde.fr/a", quote: "Les équipes se cloisonnent." }]);
  });

  it("opens in its reader at the page an excerpt cites", () => {
    const e = open([pdf, excerpt("Observation is hard.", 3)]);
    expect(openPdfAt(e, "b-1", 3)).toBe(true);
    expect(e.getJSON().content?.[0].attrs).toMatchObject({ view: "reader", page: 3 });
    expect(openPdfAt(e, "missing", 1)).toBe(false);
  });

  it("opens beside the note, at the cited page, when the host reads PDFs there", () => {
    const opened: unknown[] = [];
    editor = new Editor({
      extensions: [StarterKit.configure({ link: { openOnClick: false } }), BlockIds, ...pdfExtensions({ openBeside: (target) => opened.push(target) })],
      content: { type: "doc", content: [pdf, excerpt("Observation is hard.", 2)] },
    });
    (editor.view.dom.querySelector(".kertas-excerpt-source") as HTMLElement).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(opened).toEqual([{ id: "b-1", src: "", name: "dutta.pdf", page: 2 }]);
    expect(editor.getJSON().content?.[0].attrs?.view).toBe("line");
  });

  it("opens the PDF when the source of an excerpt is clicked", () => {
    const e = open([pdf, excerpt("Observation is hard.", 4)]);
    const source = e.view.dom.querySelector(".kertas-excerpt-source") as HTMLElement;
    source.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    expect(e.getJSON().content?.[0].attrs).toMatchObject({ view: "reader", page: 4 });
  });
});

const wasm = resolve(import.meta.dirname, "../../kertas/dist/kertas.wasm");

describe.runIf(existsSync(wasm))("a PDF kept in a note, for kertas", () => {
  it("counts a kept PDF among the note's links and writes its excerpts as quotes with their page", async () => {
    const module = await WebAssembly.instantiate(readFileSync(wasm), {});
    const kertas = kertasFrom(module.instance, () => new Date(2026, 10, 14));
    const doc = { type: "doc", content: [{ ...pdf, attrs: { ...pdf.attrs, src: "resource:r-1" } }, excerpt("Observation is hard.", 3)] };
    expect(kertas.links(doc)).toEqual([{ kind: "resource", target: "r-1" }]);
    expect(kertas.toMarkdown(doc)).toBe('[dutta.pdf](resource:r-1 "pdf")\n\n> Observation is hard.\n>\n> — [dutta.pdf, p. 3](kertas:excerpt/b-1?page=3)');
  });
});
