import { Extension, mergeAttributes, Node, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";
import type { PDFDocumentProxy } from "pdfjs-dist";

import type { ResolveImage, UploadImage } from "./writing";
import { kertasAsset } from "./assets";

export type PdfView = "line" | "card" | "reader";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExcerptAttrs {
  of: string;
  name: string;
  page: number;
  quote: string;
  rects: Rect[];
  color: string;
  kind?: "text" | "figure" | "web";
  image?: string;
  url?: string;
}

export interface WebExcerpt {
  url: string;
  title: string;
  quote: string;
  color?: string;
}

export const OPEN_WEB_EVENT = "kertas:open-web";

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export function insertWebExcerpt(editor: Editor, excerpt: WebExcerpt) {
  const attrs: ExcerptAttrs = { of: "", name: excerpt.title || hostOf(excerpt.url), page: 0, quote: excerpt.quote, rects: [], color: excerpt.color ?? EXCERPT_COLORS[0], kind: "web", url: excerpt.url };
  const { state } = editor;
  const at = state.selection.$to.after(1);
  editor.view.dispatch(state.tr.insert(Math.min(at, state.doc.content.size), state.schema.nodes.excerpt.create(attrs)).scrollIntoView());
}

function openWeb(url: string, quote: string) {
  const event = new CustomEvent(OPEN_WEB_EVENT, { detail: { url, quote }, cancelable: true });
  if (window.dispatchEvent(event)) window.open(url, "_blank", "noopener,noreferrer");
}

const sourceLabel = ({ kind, name, page, url }: ExcerptAttrs) => (kind === "web" ? `${name || hostOf(url ?? "")} · ${hostOf(url ?? "")}` : `${name} · p. ${page}`);

export const EXCERPT_COLORS = ["#fde68a", "#bfdbfe", "#fbcfe8", "#bbf7d0"];
export const EXCERPT_LINK = "kertas:excerpt/";

const VIEWS: { view: PdfView; label: string }[] = [
  { view: "line", label: "Ligne" },
  { view: "card", label: "Carte" },
  { view: "reader", label: "Lire" },
];

let pdfjs: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfjs() {
  pdfjs ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = kertasAsset("pdf.worker.min.mjs");
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = kertasAsset("pdf_viewer.css");
    document.head.append(style);
    return lib;
  });
  return pdfjs;
}

const directlyLoadable = (src: string) => src.startsWith("data:") || src.startsWith("blob:") || /^https?:/.test(src);

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function roundRect(rect: Rect): Rect {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return { x: r(rect.x), y: r(rect.y), w: r(rect.w), h: r(rect.h) };
}

export function selectionOnPage(selection: Selection | null, page: HTMLElement): { quote: string; rects: Rect[] } | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!page.contains(range.commonAncestorContainer)) return null;
  const quote = selection.toString().replace(/\s+/g, " ").trim();
  if (!quote) return null;
  const box = page.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  const rects = [...range.getClientRects()]
    .filter((r) => r.width > 1 && r.height > 1)
    .map((r) => roundRect({ x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height, w: r.width / box.width, h: r.height / box.height }));
  return { quote, rects };
}

function excerptsOf(doc: PMNode, id: string): ExcerptAttrs[] {
  const found: ExcerptAttrs[] = [];
  doc.descendants((node) => {
    if (node.type.name === "excerpt" && node.attrs.of === id) found.push(node.attrs as ExcerptAttrs);
    return node.type.name !== "excerpt";
  });
  return found;
}

function afterExcerpts(doc: PMNode, pdfPos: number, id: string): number {
  let at = pdfPos + (doc.nodeAt(pdfPos)?.nodeSize ?? 0);
  for (let next = doc.nodeAt(at); next?.type.name === "excerpt" && next.attrs.of === id; next = doc.nodeAt(at)) at += next.nodeSize;
  return at;
}

function findPdf(doc: PMNode, id: string): number | null {
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name === "pdf" && node.attrs.id === id) found = pos;
    return true;
  });
  return found;
}

export interface PdfTarget {
  id: string;
  src: string;
  name: string;
  page: number;
}

export type OpenBeside = (target: PdfTarget) => void;

const besideOf = new WeakMap<Editor, OpenBeside>();

export function openPdfAt(editor: Editor, id: string, page: number): boolean {
  const pos = findPdf(editor.state.doc, id);
  if (pos === null) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const beside = besideOf.get(editor);
  if (beside) {
    beside({ id, src: node.attrs.src as string, name: node.attrs.name as string, page });
    return true;
  }
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, view: "reader", page, focus: Date.now() }).setMeta("addToHistory", false));
  return true;
}

async function loadDocument(src: string, resolve: ResolveImage | null): Promise<PDFDocumentProxy> {
  const url = directlyLoadable(src) || !resolve ? src : await resolve(src);
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const lib = await loadPdfjs();
  return lib.getDocument({ data: bytes }).promise;
}

async function renderPage(document: PDFDocumentProxy, number: number, width: number, withText: boolean): Promise<HTMLElement> {
  const lib = await loadPdfjs();
  const page = await document.getPage(number);
  const scale = width / page.getViewport({ scale: 1 }).width;
  const viewport = page.getViewport({ scale });
  const holder = element("div", "kertas-pdf-page");
  holder.dataset.page = String(number);
  holder.style.width = `${viewport.width}px`;
  holder.style.height = `${viewport.height}px`;
  holder.style.setProperty("--scale-factor", String(scale));
  holder.style.setProperty("--total-scale-factor", String(scale));
  holder.style.setProperty("--user-unit", "1");
  holder.style.setProperty("--scale-round-x", "1px");
  holder.style.setProperty("--scale-round-y", "1px");
  const canvas = element("canvas", "kertas-pdf-canvas");
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  holder.append(canvas);
  const context = canvas.getContext("2d");
  if (context) await page.render({ canvasContext: context, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise;
  if (withText) {
    holder.append(element("div", "kertas-pdf-marks"));
    const text = element("div", "textLayer");
    holder.append(text);
    await new lib.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport }).render();
    text.append(element("div", "endOfContent"));
    text.addEventListener("mousedown", () => {
      text.classList.add("selecting");
      globalThis.document.addEventListener("pointerup", () => text.classList.remove("selecting"), { once: true });
    });
  }
  return holder;
}

export class PdfReader {
  private readonly scroller: HTMLElement;
  private readonly toolbar: HTMLElement;
  private pages: HTMLElement[] = [];
  private document: PDFDocumentProxy | null = null;
  private pending: { quote: string; rects: Rect[]; page: number; figure?: boolean } | null = null;
  private wanted: number;
  private closed = false;
  private capturing = false;
  private drawing: { page: HTMLElement; x: number; y: number; frame: HTMLElement } | null = null;
  private readonly onUpdate = () => this.paintHighlights();

  constructor(
    private readonly container: HTMLElement,
    private readonly editor: Editor,
    private readonly target: PdfTarget,
    private readonly resolve: ResolveImage | null,
    private readonly onStatus: (status: string) => void = () => {},
    private readonly upload: UploadImage | null = null,
  ) {
    this.wanted = target.page;
    this.scroller = element("div", "kertas-pdf-scroller");
    this.toolbar = this.buildToolbar();
    container.classList.add("kertas-pdf-reader");
    container.replaceChildren(this.scroller, this.toolbar);
    this.scroller.addEventListener("mouseup", () => this.offerSelection());
    this.scroller.addEventListener("keyup", () => this.offerSelection());
    this.scroller.addEventListener("scroll", () => (this.toolbar.hidden = true));
    this.scroller.addEventListener("pointerdown", (event) => this.startFrame(event));
    this.scroller.addEventListener("pointermove", (event) => this.moveFrame(event));
    this.scroller.addEventListener("pointerup", () => this.endFrame());
    editor.on("update", this.onUpdate);
    void this.render();
  }

  private buildToolbar(): HTMLElement {
    const bar = element("div", "kertas-pdf-toolbar");
    bar.hidden = true;
    for (const color of EXCERPT_COLORS) {
      const swatch = element("button", "kertas-pdf-swatch");
      swatch.type = "button";
      swatch.style.background = color;
      swatch.setAttribute("aria-label", "Surligner et mettre dans la note");
      swatch.addEventListener("mousedown", (event) => event.preventDefault());
      swatch.addEventListener("click", () => this.keepSelection(color));
      bar.append(swatch);
    }
    const keep = element("button", "kertas-pdf-keep", "→ Dans la note");
    keep.type = "button";
    keep.addEventListener("mousedown", (event) => event.preventDefault());
    keep.addEventListener("click", () => this.keepSelection(EXCERPT_COLORS[0]));
    bar.append(keep);
    return bar;
  }

  private async render() {
    try {
      this.onStatus("chargement…");
      const document = await loadDocument(this.target.src, this.resolve);
      if (this.closed) return void document.destroy();
      this.document = document;
      this.onStatus(`${document.numPages} page${document.numPages > 1 ? "s" : ""}`);
      const width = Math.min(Math.max(this.container.clientWidth - 32, 280), 900);
      for (let number = 1; number <= document.numPages; number += 1) {
        if (this.closed) return;
        const page = await renderPage(document, number, width, true);
        this.pages.push(page);
        this.scroller.append(page);
        if (number === this.wanted) this.goTo(number);
      }
      this.paintHighlights();
    } catch (error) {
      console.warn("kertas: PDF could not be read", error);
      this.onStatus("illisible");
    }
  }

  get canCapture(): boolean {
    return this.upload !== null;
  }

  setCapture(on: boolean) {
    this.capturing = on && this.upload !== null;
    this.container.classList.toggle("kertas-pdf-capturing", this.capturing);
    this.clearFrame();
  }

  private pointOn(page: HTMLElement, event: PointerEvent) {
    const box = page.getBoundingClientRect();
    return { x: Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1), y: Math.min(Math.max((event.clientY - box.top) / box.height, 0), 1) };
  }

  private startFrame(event: PointerEvent) {
    if (!this.capturing || event.button !== 0) return;
    const page = (event.target as HTMLElement).closest(".kertas-pdf-page") as HTMLElement | null;
    if (!page) return;
    event.preventDefault();
    this.clearFrame();
    const { x, y } = this.pointOn(page, event);
    const frame = element("div", "kertas-pdf-frame");
    page.append(frame);
    this.drawing = { page, x, y, frame };
    this.placeFrame(frame, { x, y, w: 0, h: 0 });
  }

  private moveFrame(event: PointerEvent) {
    const drawing = this.drawing;
    if (!drawing) return;
    const { x, y } = this.pointOn(drawing.page, event);
    this.placeFrame(drawing.frame, { x: Math.min(x, drawing.x), y: Math.min(y, drawing.y), w: Math.abs(x - drawing.x), h: Math.abs(y - drawing.y) });
  }

  private endFrame() {
    const drawing = this.drawing;
    if (!drawing) return;
    this.drawing = null;
    const rect = drawing.frame.dataset.rect ? (JSON.parse(drawing.frame.dataset.rect) as Rect) : null;
    if (!rect || rect.w < 0.02 || rect.h < 0.02) {
      drawing.frame.remove();
      return;
    }
    drawing.frame.classList.add("kertas-pdf-frame-done");
    this.pending = { quote: "", rects: [roundRect(rect)], page: Number(drawing.page.dataset.page), figure: true };
    const box = this.container.getBoundingClientRect();
    const frameBox = drawing.frame.getBoundingClientRect();
    this.toolbar.style.left = `${Math.max(8, Math.min(frameBox.left - box.left, box.width - 260))}px`;
    this.toolbar.style.top = `${Math.max(8, frameBox.top - box.top - 48)}px`;
    this.toolbar.hidden = false;
  }

  private placeFrame(frame: HTMLElement, rect: Rect) {
    frame.dataset.rect = JSON.stringify(rect);
    Object.assign(frame.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` });
  }

  private clearFrame() {
    for (const frame of this.container.querySelectorAll(".kertas-pdf-frame")) frame.remove();
    this.drawing = null;
    if (this.pending?.figure) this.pending = null;
    this.toolbar.hidden = true;
  }

  private async cropFigure(page: number, rect: Rect): Promise<File | null> {
    const document = this.document;
    if (!document) return null;
    const lib = await loadPdfjs();
    const pdfPage = await document.getPage(page);
    const viewport = pdfPage.getViewport({ scale: 2.5 });
    const full = globalThis.document.createElement("canvas");
    full.width = Math.floor(viewport.width);
    full.height = Math.floor(viewport.height);
    const context = full.getContext("2d");
    if (!context || !lib) return null;
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    const crop = globalThis.document.createElement("canvas");
    crop.width = Math.max(1, Math.round(rect.w * full.width));
    crop.height = Math.max(1, Math.round(rect.h * full.height));
    crop.getContext("2d")?.drawImage(full, rect.x * full.width, rect.y * full.height, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const blob = await new Promise<Blob | null>((resolve) => crop.toBlob(resolve, "image/png"));
    return blob ? new File([blob], `${(this.target.name || "document").replace(/\.pdf$/i, "")}-p${page}.png`, { type: "image/png" }) : null;
  }

  goTo(number: number) {
    this.wanted = number;
    const page = this.pages[number - 1];
    if (!page) return;
    this.scroller.scrollTop = page.offsetTop - this.scroller.offsetTop;
    page.classList.remove("kertas-pdf-flash");
    void page.offsetWidth;
    page.classList.add("kertas-pdf-flash");
  }

  private paintHighlights() {
    if (!this.pages.length) return;
    for (const page of this.pages) page.querySelector(".kertas-pdf-marks")?.replaceChildren();
    for (const excerpt of excerptsOf(this.editor.state.doc, this.target.id)) {
      const marks = this.pages[excerpt.page - 1]?.querySelector(".kertas-pdf-marks");
      for (const rect of excerpt.rects ?? []) {
        const mark = element("span", excerpt.kind === "figure" ? "kertas-pdf-mark kertas-pdf-mark-figure" : "kertas-pdf-mark");
        Object.assign(mark.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, background: excerpt.color });
        mark.style.setProperty("--excerpt-color", excerpt.color);
        marks?.append(mark);
      }
    }
  }

  private offerSelection() {
    if (this.capturing) return;
    const selection = window.getSelection();
    for (const page of this.pages) {
      const picked = selectionOnPage(selection, page);
      if (!picked) continue;
      this.pending = { ...picked, page: Number(page.dataset.page) };
      const range = selection!.getRangeAt(0).getBoundingClientRect();
      const box = this.container.getBoundingClientRect();
      this.toolbar.style.left = `${Math.max(8, Math.min(range.left - box.left, box.width - 260))}px`;
      this.toolbar.style.top = `${Math.max(8, range.top - box.top - 48)}px`;
      this.toolbar.hidden = false;
      return;
    }
    this.pending = null;
    this.toolbar.hidden = true;
  }

  private keepSelection(color: string) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.toolbar.hidden = true;
    if (pending.figure) {
      void this.keepFigure(pending, color);
      return;
    }
    this.insertExcerpt({ of: this.target.id, name: this.target.name || "document.pdf", page: pending.page, quote: pending.quote, rects: pending.rects, color, kind: "text" });
    window.getSelection()?.removeAllRanges();
  }

  private async keepFigure(pending: { rects: Rect[]; page: number }, color: string) {
    const upload = this.upload;
    const file = upload ? await this.cropFigure(pending.page, pending.rects[0]) : null;
    this.clearFrame();
    if (!upload || !file) return;
    const image = await upload(file);
    this.insertExcerpt({ of: this.target.id, name: this.target.name || "document.pdf", page: pending.page, quote: "", rects: pending.rects, color, kind: "figure", image });
  }

  private insertExcerpt(attrs: ExcerptAttrs) {
    const { state } = this.editor;
    const pos = findPdf(state.doc, this.target.id);
    if (pos === null) return;
    this.editor.view.dispatch(state.tr.insert(afterExcerpts(state.doc, pos, this.target.id), state.schema.nodes.excerpt.create(attrs)));
  }

  destroy() {
    this.closed = true;
    this.editor.off("update", this.onUpdate);
    void this.document?.destroy();
  }
}

class PdfBlockView implements NodeView {
  dom: HTMLElement;
  private node: PMNode;
  private readonly body: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly buttons = new Map<PdfView, HTMLButtonElement>();
  private reader: PdfReader | null = null;
  private card: PDFDocumentProxy | null = null;
  private shown: PdfView | null = null;

  constructor(
    node: PMNode,
    private readonly editor: Editor,
    private readonly getPos: () => number | undefined,
    private readonly resolve: ResolveImage | null,
    private readonly beside: OpenBeside | null,
  ) {
    this.node = node;
    this.dom = element("div", "kertas-pdf");
    this.dom.contentEditable = "false";
    this.dom.draggable = false;
    const header = element("div", "kertas-pdf-header");
    const badge = element("span", "kertas-pdf-badge", "PDF");
    const name = element("strong", "kertas-pdf-name");
    this.meta = element("span", "kertas-pdf-meta");
    const views = element("div", "kertas-pdf-views");
    for (const { view, label } of VIEWS) {
      const button = element("button", "kertas-pdf-view", view === "reader" && beside ? "Ouvrir à côté" : label);
      button.type = "button";
      button.addEventListener("click", () => (view === "reader" && beside ? this.openBeside() : this.setView(view)));
      this.buttons.set(view, button);
      views.append(button);
    }
    header.append(badge, name, this.meta, views);
    this.body = element("div", "kertas-pdf-body");
    this.dom.append(header, this.body);
    this.render();
  }

  private openBeside() {
    const id = (this.node.attrs.id as string | null) ?? "";
    if (id) this.beside?.({ id, src: this.node.attrs.src as string, name: this.node.attrs.name as string, page: (this.node.attrs.page as number) ?? 1 });
  }

  private setView(view: PdfView) {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.editor.view.dispatch(this.editor.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, view }));
  }

  private clear() {
    this.reader?.destroy();
    this.reader = null;
    void this.card?.destroy();
    this.card = null;
    this.body.replaceChildren();
  }

  private render() {
    const stored = (this.node.attrs.view as PdfView) ?? "line";
    const view: PdfView = stored === "reader" && this.beside ? "card" : stored;
    (this.dom.querySelector(".kertas-pdf-name") as HTMLElement).textContent = (this.node.attrs.name as string) || "document.pdf";
    this.dom.dataset.view = view;
    for (const [key, button] of this.buttons) button.setAttribute("aria-pressed", String(key === view && !(key === "reader" && this.beside)));
    if (view === this.shown) return;
    this.shown = view;
    this.clear();
    if (view === "card") void this.renderCard();
    if (view === "reader") {
      const id = (this.node.attrs.id as string | null) ?? "";
      const holder = element("div", "kertas-pdf-inline");
      this.body.append(holder);
      this.reader = new PdfReader(holder, this.editor, { id, src: this.node.attrs.src as string, name: this.node.attrs.name as string, page: (this.node.attrs.page as number) ?? 1 }, this.resolve, (status) => (this.meta.textContent = status));
    }
  }

  private async renderCard() {
    try {
      const document = await loadDocument(this.node.attrs.src as string, this.resolve);
      if (this.shown !== "card") return void document.destroy();
      this.card = document;
      this.meta.textContent = `${document.numPages} page${document.numPages > 1 ? "s" : ""}`;
      const thumb = await renderPage(document, 1, 140, false);
      if (this.shown === "card") this.body.replaceChildren(thumb);
    } catch (error) {
      console.warn("kertas: PDF could not be read", error);
      this.meta.textContent = "illisible";
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const previous = this.node;
    this.node = node;
    if (node.attrs.src !== previous.attrs.src) this.shown = null;
    this.render();
    if (node.attrs.focus !== previous.attrs.focus) {
      this.reader?.goTo(node.attrs.page as number);
      this.dom.scrollIntoView({ block: "nearest" });
    }
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target instanceof globalThis.Node ? event.target : null;
    return Boolean(target && (this.body.contains(target) || (target as HTMLElement).tagName === "BUTTON"));
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy() {
    this.clear();
  }
}

export interface PdfOptions {
  resolve: ResolveImage | null;
  openBeside: OpenBeside | null;
}

export const PdfBlock = Node.create<PdfOptions>({
  name: "pdf",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { resolve: null, openBeside: null };
  },

  onBeforeCreate() {
    if (this.options.openBeside) besideOf.set(this.editor, this.options.openBeside);
  },

  addAttributes() {
    return {
      src: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-src") ?? "", renderHTML: (a: Record<string, unknown>) => ({ "data-src": a.src }) },
      name: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-name") ?? "", renderHTML: (a: Record<string, unknown>) => ({ "data-name": a.name }) },
      view: { default: "line", parseHTML: (el: HTMLElement) => el.getAttribute("data-view") ?? "line", renderHTML: (a: Record<string, unknown>) => ({ "data-view": a.view }) },
      page: { default: 1, parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-page") ?? 1), renderHTML: (a: Record<string, unknown>) => ({ "data-page": a.page }) },
      focus: { default: 0, rendered: false },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-kertas-pdf]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-kertas-pdf": "" }), node.attrs.name || "document.pdf"];
  },

  addNodeView() {
    const { resolve, openBeside } = this.options;
    return ({ node, editor, getPos }) => new PdfBlockView(node, editor, getPos as () => number | undefined, resolve, openBeside);
  },
});

export const Excerpt = Node.create<{ resolve: ResolveImage | null }>({
  name: "excerpt",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { resolve: null };
  },

  addAttributes() {
    const plain = (key: string, fallback: unknown) => ({
      default: fallback,
      parseHTML: (el: HTMLElement) => el.getAttribute(`data-${key}`) ?? fallback,
      renderHTML: (a: Record<string, unknown>) => ({ [`data-${key}`]: a[key] }),
    });
    return {
      of: plain("of", ""),
      name: plain("name", ""),
      quote: plain("quote", ""),
      color: plain("color", EXCERPT_COLORS[0]),
      kind: plain("kind", "text"),
      image: plain("image", ""),
      url: plain("url", ""),
      page: { default: 1, parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-page") ?? 1), renderHTML: (a: Record<string, unknown>) => ({ "data-page": a.page }) },
      rects: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute("data-rects") ?? "[]");
          } catch {
            return [];
          }
        },
        renderHTML: (a: Record<string, unknown>) => ({ "data-rects": JSON.stringify(a.rects ?? []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "blockquote[data-excerpt]", priority: 100 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { name, page, quote, color, of, kind, image } = node.attrs as ExcerptAttrs;
    const body = kind === "figure" ? ["img", { class: "kertas-excerpt-figure", src: image, alt: `${name}, p. ${page}` }] : ["p", { class: "kertas-excerpt-quote" }, quote];
    return [
      "blockquote",
      mergeAttributes(HTMLAttributes, { "data-excerpt": "", class: kind === "figure" ? "kertas-excerpt kertas-excerpt-is-figure" : "kertas-excerpt", style: `--excerpt-color: ${color}` }),
      body,
      ["button", { type: "button", class: "kertas-excerpt-source", "data-source": of, "data-source-page": String(page), "data-url": (node.attrs as ExcerptAttrs).url ?? "" }, sourceLabel(node.attrs as ExcerptAttrs)],
    ];
  },

  addNodeView() {
    const resolve = this.options.resolve;
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("blockquote");
      let current = node;
      const paint = () => {
        const { name, page, quote, color, of, kind, image } = current.attrs as ExcerptAttrs;
        for (const [key, value] of Object.entries(HTMLAttributes)) if (typeof value === "string" && key.startsWith("data-")) dom.setAttribute(key, value);
        dom.setAttribute("data-excerpt", "");
        dom.className = kind === "figure" ? "kertas-excerpt kertas-excerpt-is-figure" : "kertas-excerpt";
        dom.style.setProperty("--excerpt-color", color);
        let body: HTMLElement;
        if (kind === "figure") {
          const img = element("img", "kertas-excerpt-figure");
          img.alt = `${name}, p. ${page}`;
          if (!resolve || directlyLoadable(image ?? "")) img.src = image ?? "";
          else void resolve(image ?? "").then((url) => (img.src = url));
          body = img;
        } else body = element("p", "kertas-excerpt-quote", quote);
        const source = element("button", "kertas-excerpt-source", sourceLabel(current.attrs as ExcerptAttrs));
        source.type = "button";
        source.dataset.source = of;
        source.dataset.sourcePage = String(page);
        source.dataset.url = (current.attrs as ExcerptAttrs).url ?? "";
        dom.replaceChildren(body, source);
      };
      paint();
      return {
        dom,
        update: (next) => {
          if (next.type !== current.type) return false;
          current = next;
          paint();
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
});

function pdfFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name));
}

export function insertPdfs(editor: Editor, files: File[], upload: UploadImage, at?: number) {
  for (const file of files) {
    void upload(file).then((src) => {
      const content = [{ type: "pdf", attrs: { src, name: file.name, view: "card" } }, { type: "paragraph" }];
      if (at === undefined) editor.chain().focus().insertContent(content).run();
      else editor.chain().focus().insertContentAt(Math.min(at, editor.state.doc.content.size), content).run();
    });
  }
}

export function pickPdfs(editor: Editor, upload: UploadImage) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,.pdf";
  input.multiple = true;
  input.addEventListener("change", () => insertPdfs(editor, pdfFiles(input.files), upload));
  input.click();
}

export const PdfDrop = Extension.create<{ upload: UploadImage | null }>({
  name: "kertasPdfDrop",

  addOptions() {
    return { upload: null };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const { upload } = this.options;
    return [
      new Plugin({
        key: new PluginKey("kertasPdfDrop"),
        props: {
          handlePaste(_view, event) {
            const files = pdfFiles(event.clipboardData?.files);
            if (!files.length || !upload) return false;
            insertPdfs(editor, files, upload);
            return true;
          },
          handleDrop(view, event) {
            const files = pdfFiles((event as DragEvent).dataTransfer?.files);
            if (!files.length || !upload) return false;
            insertPdfs(editor, files, upload, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
            return true;
          },
          handleDOMEvents: {
            mousedown(_view, event) {
              const source = (event.target as HTMLElement | null)?.closest?.(".kertas-excerpt-source") as HTMLElement | null;
              if (source?.dataset.url) {
                event.preventDefault();
                const quote = source.closest(".kertas-excerpt")?.querySelector(".kertas-excerpt-quote")?.textContent ?? "";
                openWeb(source.dataset.url, quote);
                return true;
              }
              if (!source?.dataset.source) return false;
              event.preventDefault();
              openPdfAt(editor, source.dataset.source, Number(source.dataset.sourcePage ?? 1));
              return true;
            },
          },
        },
      }),
    ];
  },
});

export function pdfExtensions(options: { upload?: UploadImage; resolve?: ResolveImage; openBeside?: OpenBeside } = {}) {
  return [PdfBlock.configure({ resolve: options.resolve ?? null, openBeside: options.openBeside ?? null }), Excerpt.configure({ resolve: options.resolve ?? null }), PdfDrop.configure({ upload: options.upload ?? null })];
}
