import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import type { SlashItem } from "../index";

export interface PageSummary {
  id: string;
  title: string;
}

export interface PageRefOptions {
  openPage: (id: string) => void;
}

export interface PageRefAttrs {
  page: string;
  title: string;
}

const UNTITLED = "Sans titre";

export const PageRef = Node.create<PageRefOptions>({
  name: "pageRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { openPage: () => {} };
  },

  addAttributes() {
    return {
      page: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-page") ?? "",
        renderHTML: (attributes) => ({ "data-page": attributes.page }),
      },
      title: {
        default: "",
        parseHTML: (element) => element.textContent ?? "",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-page-ref]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = (node.attrs as PageRefAttrs).title || UNTITLED;
    return ["span", mergeAttributes(HTMLAttributes, { "data-page-ref": "", class: "kertas-page-ref" }), title];
  },

  renderText({ node }) {
    return `@${(node.attrs as PageRefAttrs).title || UNTITLED}`;
  },

  addProseMirrorPlugins() {
    const { openPage } = this.options;
    return [
      new Plugin({
        key: new PluginKey("kertasPageRef"),
        props: {
          handleClickOn(_view, _pos, node) {
            if (node.type.name !== "pageRef") return false;
            openPage((node.attrs as PageRefAttrs).page);
            return true;
          },
        },
      }),
    ];
  },
});

export interface PageRefLabels {
  create: (title: string) => string;
  createDescription: string;
  subPage: string;
  subPageDescription: string;
}

export const defaultPageRefLabels: PageRefLabels = {
  create: (title) => `Créer la page « ${title} »`,
  createDescription: "une nouvelle page, citée ici",
  subPage: "Sous-page",
  subPageDescription: "une page rangée dans celle-ci",
};

/** Creates a page named title, filed under home (null: the workspace root). */
export type CreatePage = (title: string, home: string | null) => PageSummary | Promise<PageSummary>;

function cite(editor: Editor, at: number, page: PageSummary): void {
  const position = Math.min(at, editor.state.doc.content.size);
  editor
    .chain()
    .focus()
    .insertContentAt(position, [
      { type: "pageRef", attrs: { page: page.id, title: page.title } },
      { type: "text", text: " " },
    ])
    .run();
}

const sameTitle = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

export function pageRefItems(
  pages: () => PageSummary[],
  current: () => string | null,
  create?: CreatePage,
  labels: PageRefLabels = defaultPageRefLabels,
): (query: string) => SlashItem[] {
  return (query = "") => {
    const cited = pages()
      .filter((page) => page.id !== current())
      .map(
        (page): SlashItem => ({
          id: `page-${page.id}`,
          title: page.title || UNTITLED,
          command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run();
            cite(editor, range.from, page);
          },
        }),
      );
    const title = query.trim();
    if (!create || !title || pages().some((page) => sameTitle(page.title, title))) return cited;
    return [
      ...cited,
      {
        id: "page-create",
        title: labels.create(title),
        description: labels.createDescription,
        command: ({ editor, range }) => {
          editor.chain().focus().deleteRange(range).run();
          void Promise.resolve(create(title, null)).then((page) => cite(editor, range.from, page));
        },
      },
    ];
  };
}

/** The `/` item that files a new page under the current one, cites it there and opens it. */
export function subPageItem(
  current: () => string | null,
  create: CreatePage,
  open: (id: string) => void,
  labels: PageRefLabels = defaultPageRefLabels,
): SlashItem {
  return {
    id: "page-sub",
    title: labels.subPage,
    description: labels.subPageDescription,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      void Promise.resolve(create(UNTITLED, current())).then((page) => {
        cite(editor, range.from, page);
        open(page.id);
      });
    },
  };
}

export function refreshPageTitles(editor: Editor, titleOf: (id: string) => string | undefined): void {
  const { tr, doc } = editor.state;
  doc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== "pageRef") return true;
    const attrs = node.attrs as PageRefAttrs;
    const title = titleOf(attrs.page);
    if (title !== undefined && title !== attrs.title) tr.setNodeMarkup(pos, undefined, { ...attrs, title });
    return false;
  });
  if (tr.docChanged) editor.view.dispatch(tr.setMeta("addToHistory", false));
}
