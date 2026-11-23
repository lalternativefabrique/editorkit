import { Extension, mergeAttributes, Node, type Editor } from "@tiptap/core";
import Image, { type ImageOptions } from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "@tiptap/pm/view";
import type { SlashItem } from "../index";

import { type OpenBeside, pdfExtensions, pickPdfs } from "./pdf";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    writing: {
      insertContents: () => ReturnType;
      insertFootnote: (text: string) => ReturnType;
      insertColumns: (count: number) => ReturnType;
    };
  }
}

/** Uploads an image somewhere lasting and answers its address. */
export type UploadImage = (file: File) => Promise<string>;

/** Turns a stored address into one an image element can load, such as a blob URL fetched with the host's credentials. */
export type ResolveImage = (src: string) => Promise<string>;

/** An image whose address may need the host to load it. */
const StoredImage = Image.extend<ImageOptions & { resolve: ResolveImage | null }>({
  addOptions() {
    return { inline: false, allowBase64: false, HTMLAttributes: {}, resize: false, ...this.parent?.(), resolve: null } as ImageOptions & {
      resolve: ResolveImage | null;
    };
  },

  addNodeView() {
    const resolve = this.options.resolve;
    return ({ node }): NodeView => {
      const img = document.createElement("img");
      let current = node;
      const paint = () => {
        img.alt = (current.attrs.alt as string) ?? "";
        const src = current.attrs.src as string;
        if (!resolve || src.startsWith("data:") || /^https?:/.test(src)) {
          img.src = src;
          return;
        }
        void resolve(src).then((url) => {
          if (current.attrs.src === src) img.src = url;
        });
      };
      paint();
      return {
        dom: img,
        update: (next) => {
          if (next.type !== current.type) return false;
          current = next;
          paint();
          return true;
        },
      };
    };
  },
});

const asDataUrl: UploadImage = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const askNote = (text: string) => window.prompt("Note de bas de page", text);

function headingsOf(doc: PMNode): { level: number; text: string; pos: number }[] {
  const out: { level: number; text: string; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading" && node.textContent.trim()) out.push({ level: node.attrs.level as number, text: node.textContent, pos });
    return node.type.name !== "heading";
  });
  return out;
}

/** The headings of the document, kept up to date; a click goes to one. */
export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "nav[data-contents]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["nav", mergeAttributes(HTMLAttributes, { "data-contents": "", class: "kertas-contents" })];
  },

  addCommands() {
    return {
      insertContents:
        () =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name }, { type: "paragraph" }]),
    };
  },

  addNodeView() {
    return ({ editor }): NodeView => {
      const dom = document.createElement("nav");
      dom.className = "kertas-contents";
      dom.contentEditable = "false";
      const paint = () => {
        const headings = headingsOf(editor.state.doc);
        const title = document.createElement("div");
        title.className = "kertas-contents-title";
        title.textContent = "Sommaire";
        const list = document.createElement("ol");
        for (const heading of headings) {
          const item = document.createElement("li");
          item.style.paddingLeft = `${(heading.level - 1) * 1.2}em`;
          const link = document.createElement("button");
          link.type = "button";
          link.textContent = heading.text;
          link.addEventListener("mousedown", (event) => event.preventDefault());
          link.addEventListener("click", () => {
            const target = editor.view.nodeDOM(heading.pos);
            if (target instanceof HTMLElement) target.scrollIntoView({ behavior: "smooth", block: "start" });
          });
          item.append(link);
          list.append(item);
        }
        if (!headings.length) list.append(Object.assign(document.createElement("li"), { textContent: "Les titres de la page apparaîtront ici." }));
        dom.replaceChildren(title, list);
      };
      paint();
      editor.on("update", paint);
      return {
        dom,
        update: (node) => node.type.name === "tableOfContents",
        destroy: () => editor.off("update", paint),
        ignoreMutation: () => true,
      };
    };
  },
});

const footnotesKey = new PluginKey("kertasFootnotes");

function notesOf(doc: PMNode): string[] {
  const notes: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "footnote") notes.push(node.attrs.text as string);
  });
  return notes;
}

/** A note numbered in the text and listed at the end of the page; a click edits it. */
export const Footnote = Node.create<{ ask: (text: string) => string | null }>({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { ask: askNote };
  },

  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-note") ?? "",
        renderHTML: (attributes) => ({ "data-note": attributes.text, title: attributes.text }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "sup[data-footnote]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes, { "data-footnote": "", class: "kertas-footnote" })];
  },

  renderText() {
    return "*";
  },

  addCommands() {
    return {
      insertFootnote:
        (text) =>
        ({ commands }) =>
          text.trim() ? commands.insertContent({ type: this.name, attrs: { text: text.trim() } }) : false,
    };
  },

  addProseMirrorPlugins() {
    const { ask } = this.options;
    return [
      new Plugin({
        key: footnotesKey,
        props: {
          decorations(state) {
            const notes = notesOf(state.doc);
            if (!notes.length) return DecorationSet.empty;
            const list = () => {
              const section = document.createElement("ol");
              section.className = "kertas-footnotes";
              section.contentEditable = "false";
              for (const note of notes) section.append(Object.assign(document.createElement("li"), { textContent: note }));
              return section;
            };
            return DecorationSet.create(state.doc, [Decoration.widget(state.doc.content.size, list, { side: 1, key: notes.join("\u0000") })]);
          },
          handleClickOn(view: EditorView, _pos, node, nodePos) {
            if (node.type.name !== "footnote") return false;
            const text = ask(node.attrs.text as string);
            if (text === null) return true;
            const tr = text.trim() ? view.state.tr.setNodeMarkup(nodePos, undefined, { text: text.trim() }) : view.state.tr.delete(nodePos, nodePos + node.nodeSize);
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});

export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,

  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "", class: "kertas-col" }), 0];
  },
});

/** Two or three columns side by side, each holding any blocks. */
export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,3}",
  defining: true,

  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-columns": "", class: "kertas-cols" }), 0];
  },

  addCommands() {
    return {
      insertColumns:
        (count) =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: this.name,
              content: Array.from({ length: Math.min(3, Math.max(2, count)) }, () => ({ type: "column", content: [{ type: "paragraph" }] })),
            })
            .command(({ tr }) => {
              let start = -1;
              tr.doc.nodesBetween(0, tr.selection.from, (node, pos) => {
                if (node.type.name === "columns") start = pos;
              });
              if (start >= 0) tr.setSelection(TextSelection.near(tr.doc.resolve(start + 3)));
              return true;
            })
            .run(),
    };
  },
});

function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith("image/"));
}

function insertImages(editor: Editor, files: File[], upload: UploadImage, at?: number) {
  for (const file of files) {
    void upload(file).then((src) => {
      const content = { type: "image", attrs: { src, alt: file.name.replace(/\.[^.]+$/, "") } };
      if (at === undefined) editor.chain().focus().insertContent(content).run();
      else editor.chain().focus().insertContentAt(Math.min(at, editor.state.doc.content.size), content).run();
    });
  }
}

/** Pasted or dropped images go through the host's upload, then into the document. */
const ImageDrop = Extension.create<{ upload: UploadImage }>({
  name: "kertasImageDrop",

  addOptions() {
    return { upload: asDataUrl };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const { upload } = this.options;
    return [
      new Plugin({
        key: new PluginKey("kertasImageDrop"),
        props: {
          handlePaste(_view, event) {
            const files = imageFiles(event.clipboardData?.files);
            if (!files.length) return false;
            insertImages(editor, files, upload);
            return true;
          },
          handleDrop(view, event) {
            const files = imageFiles((event as DragEvent).dataTransfer?.files);
            if (!files.length) return false;
            const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
            insertImages(editor, files, upload, at);
            return true;
          },
        },
      }),
    ];
  },
});

export interface LinkCard {
  url: string;
  title: string;
  description?: string;
  image?: string;
  site?: string;
}

/** Reads what a page says about itself, through the host: a browser cannot read another site's page. */
export type PreviewLink = (url: string) => Promise<Partial<LinkCard>>;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const isWebAddress = (text: string) => /^https?:\/\/\S+$/.test(text.trim());

/** A card showing a web page: its title, description, image and site; a click opens it. */
export const LinkPreview = Node.create({
  name: "linkPreview",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return Object.fromEntries(
      ["url", "title", "description", "image", "site"].map((key) => [
        key,
        { default: "", parseHTML: (element: HTMLElement) => element.getAttribute(`data-${key}`) ?? "", renderHTML: (attributes: Record<string, string>) => ({ [`data-${key}`]: attributes[key] }) },
      ]),
    );
  },

  parseHTML() {
    return [{ tag: "a[data-link-preview]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { url, title, description, image, site } = node.attrs as LinkCard;
    const text = ["div", { class: "kertas-preview-text" }, ["strong", {}, title || hostOf(url)], ["span", {}, description ?? ""], ["small", {}, site || hostOf(url)]];
    return [
      "a",
      mergeAttributes(HTMLAttributes, { "data-link-preview": "", class: "kertas-preview", href: url, target: "_blank", rel: "noopener noreferrer" }),
      text,
      ...(image ? [["img", { src: image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }]] : []),
    ] as never;
  },
});

function fillCard(editor: Editor, url: string, preview: PreviewLink | undefined) {
  if (!preview) return;
  void preview(url)
    .then((card) => {
      const { state } = editor;
      const tr = state.tr;
      state.doc.descendants((node, pos) => {
        if (node.type.name === "linkPreview" && node.attrs.url === url && !node.attrs.description && !node.attrs.image) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...card, url, title: card.title || node.attrs.title });
        }
      });
      if (tr.docChanged) editor.view.dispatch(tr);
    })
    .catch(() => undefined);
}

function insertCard(editor: Editor, url: string, preview: PreviewLink | undefined) {
  editor.chain().focus().insertContent([{ type: "linkPreview", attrs: { url, title: hostOf(url), site: hostOf(url) } }, { type: "paragraph" }]).run();
  fillCard(editor, url, preview);
}

/** A web address pasted alone on an empty line becomes a card. */
const LinkPaste = Extension.create<{ preview?: PreviewLink }>({
  name: "kertasLinkPaste",

  addProseMirrorPlugins() {
    const editor = this.editor;
    const preview = this.options.preview;
    return [
      new Plugin({
        key: new PluginKey("kertasLinkPaste"),
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain") ?? "";
            const { $from, empty } = view.state.selection;
            if (!empty || !isWebAddress(text) || $from.parent.type.name !== "paragraph" || $from.parent.content.size > 0) return false;
            insertCard(editor, text.trim(), preview);
            return true;
          },
        },
      }),
    ];
  },
});

export interface WritingOptions {
  upload?: UploadImage;
  resolve?: ResolveImage;
  preview?: PreviewLink;
  askNote?: (text: string) => string | null;
  askUrl?: (text: string) => string | null;
  openPdf?: OpenBeside;
}

/** Alignment, contents, footnotes, columns and images. */
export function writingExtensions(options: WritingOptions = {}) {
  return [
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TableOfContents,
    Footnote.configure({ ask: options.askNote ?? askNote }),
    Column,
    Columns,
    StoredImage.configure({ allowBase64: true, resolve: options.resolve ?? null }),
    ImageDrop.configure({ upload: options.upload ?? asDataUrl }),
    LinkPreview,
    LinkPaste.configure({ preview: options.preview }),
    ...pdfExtensions({ upload: options.upload ?? asDataUrl, resolve: options.resolve, openBeside: options.openPdf }),
  ];
}

function pickImages(editor: Editor, upload: UploadImage) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = true;
  input.addEventListener("change", () => insertImages(editor, imageFiles(input.files), upload));
  input.click();
}

export function writingSlashItems(options: WritingOptions = {}): SlashItem[] {
  const ask = options.askNote ?? askNote;
  const upload = options.upload ?? asDataUrl;
  const item = (id: string, title: string, description: string, run: (editor: Editor) => void): SlashItem => ({
    id,
    title,
    description,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      run(editor);
    },
  });
  return [
    item("image", "Image", "depuis tes fichiers, ou colle-la directement", (editor) => pickImages(editor, upload)),
    item("pdf", "PDF", "à lire dans la note et à citer, depuis tes fichiers", (editor) => pickPdfs(editor, upload)),
    item("link-preview", "Aperçu de lien", "une carte avec le titre et l'image d'une page", (editor) => {
      const url = (options.askUrl ?? ((text: string) => window.prompt("Adresse de la page", text)))("https://")?.trim();
      if (url && isWebAddress(url)) insertCard(editor, url, options.preview);
    }),
    item("contents", "Table des matières", "les titres de la page, à jour", (editor) => editor.commands.insertContents()),
    item("footnote", "Note de bas de page", "une précision numérotée en fin de page", (editor) => {
      const text = ask("");
      if (text) editor.commands.insertFootnote(text);
    }),
    item("columns-2", "Deux colonnes", "côte à côte", (editor) => editor.commands.insertColumns(2)),
    item("columns-3", "Trois colonnes", "côte à côte", (editor) => editor.commands.insertColumns(3)),
    item("align-center", "Centrer", "le paragraphe ou le titre", (editor) => editor.commands.setTextAlign("center")),
    item("align-right", "Aligner à droite", "le paragraphe ou le titre", (editor) => editor.commands.setTextAlign("right")),
    item("align-justify", "Justifier", "le paragraphe", (editor) => editor.commands.setTextAlign("justify")),
    item("align-left", "Aligner à gauche", "comme d'habitude", (editor) => editor.commands.setTextAlign("left")),
  ];
}
