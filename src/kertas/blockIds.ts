import { Extension } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

export const BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "taskList",
  "taskItem",
  "callout",
  "toggle",
  "tableOfContents",
  "image",
  "columns",
  "column",
  "linkPreview",
  "pdf",
  "excerpt",
];

export interface BlockIdsOptions {
  types: string[];
  newId: () => string;
}

export const BlockIds = Extension.create<BlockIdsOptions>({
  name: "kertasBlockIds",

  addOptions() {
    return { types: BLOCK_TYPES, newId: () => crypto.randomUUID() };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          id: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute("data-id"),
            renderHTML: (attributes) => (attributes.id ? { "data-id": attributes.id } : {}),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const { types, newId } = this.options;
    const assign = (state: EditorState): Transaction | null => {
      const seen = new Set<string>();
      const tr = state.tr;
      state.doc.descendants((node, pos) => {
        if (!types.includes(node.type.name)) return true;
        const id = node.attrs.id as string | null;
        if (id && !seen.has(id)) {
          seen.add(id);
          return true;
        }
        const fresh = newId();
        seen.add(fresh);
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: fresh });
        return true;
      });
      return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
    };
    return [
      new Plugin({
        key: new PluginKey("kertasBlockIds"),
        appendTransaction: (transactions, _old, state) => (transactions.some((tr) => tr.docChanged) ? assign(state) : null),
        view: (view) => {
          const tr = assign(view.state);
          if (tr) view.dispatch(tr.setMeta("preventUpdate", true));
          return {};
        },
      }),
    ];
  },
});
