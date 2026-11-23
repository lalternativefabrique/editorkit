import type { Content, Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";

export interface PageSetup {
  size: "A4" | "letter";
  orientation: "portrait" | "landscape";
  margins: "narrow" | "normal" | "wide";
  header: boolean;
  numbers: boolean;
}

export const DEFAULT_PAGE_SETUP: PageSetup = {
  size: "A4",
  orientation: "portrait",
  margins: "normal",
  header: true,
  numbers: true,
};

const MARGINS: Record<PageSetup["margins"], string> = {
  narrow: "12mm",
  normal: "20mm",
  wide: "30mm",
};

export const PAGE_SETUP_LABELS = {
  size: { A4: "A4", letter: "Lettre US" },
  orientation: { portrait: "Portrait", landscape: "Paysage" },
  margins: { narrow: "Étroites", normal: "Normales", wide: "Larges" },
} as const;

const DOCUMENT_ATTRIBUTES = ["page", "comments"] as const;

/** The document node, keeping how its pages are printed and its comment threads. */
export const PrintableDocument = Document.extend({
  addAttributes() {
    return Object.fromEntries(DOCUMENT_ATTRIBUTES.map((name) => [name, { default: null, parseHTML: () => null, renderHTML: () => ({}) }]));
  },
});

export function pageSetupOf(doc: { attrs?: Record<string, unknown> }): PageSetup {
  return { ...DEFAULT_PAGE_SETUP, ...((doc.attrs?.page as Partial<PageSetup> | null) ?? {}) };
}

const quoted = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;

/** The @page rules for a document: paper, margins, its title on top, page numbers below. */
export function pageStyle(setup: PageSetup, title: string): string {
  const margin = MARGINS[setup.margins];
  const boxes = [
    setup.header && title.trim() ? `@top-left { content: ${quoted(title.trim())}; font: 9pt system-ui, sans-serif; color: #6b7280; }` : "",
    setup.numbers ? `@bottom-right { content: counter(page) " / " counter(pages); font: 9pt system-ui, sans-serif; color: #6b7280; }` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `@page { size: ${setup.size} ${setup.orientation}; margin: ${margin}; ${boxes} }`;
}

/**
 * Prints a document alone, whatever page it sits in: on beforeprint, once its
 * tables have drawn every row, a copy of source and its title goes in a root
 * the print stylesheet keeps while hiding the rest.
 */
export function printDocument(setup: PageSetup, title: string, source: HTMLElement): void {
  const style = document.createElement("style");
  style.textContent = pageStyle(setup, title);
  const root = document.createElement("div");
  root.className = "kertas-print-root";
  const copy = () => {
    const heading = document.createElement("h1");
    heading.className = "kertas-print-title";
    heading.textContent = title;
    root.replaceChildren(heading, source.cloneNode(true));
  };
  const done = () => {
    style.remove();
    root.remove();
    document.documentElement.classList.remove("kertas-printing");
    window.removeEventListener("beforeprint", copy);
    window.removeEventListener("afterprint", done);
  };
  document.head.appendChild(style);
  document.body.appendChild(root);
  document.documentElement.classList.add("kertas-printing");
  window.addEventListener("beforeprint", copy);
  window.addEventListener("afterprint", done);
  window.print();
}

/**
 * Shows a document in an editor, its page setup and comments included:
 * setContent alone keeps the attributes of the document shown before.
 */
export function showDocument(editor: Editor, content: Content): void {
  editor.commands.setContent(content, { emitUpdate: false });
  const attrs = typeof content === "object" && content && !Array.isArray(content) ? (content.attrs ?? {}) : {};
  const tr = editor.state.tr;
  for (const name of DOCUMENT_ATTRIBUTES) {
    const value = attrs[name] ?? null;
    if (editor.state.doc.attrs[name] !== value) tr.setDocAttribute(name, value);
  }
  if (tr.docChanged || tr.steps.length) editor.view.dispatch(tr.setMeta("preventUpdate", true).setMeta("addToHistory", false));
}
