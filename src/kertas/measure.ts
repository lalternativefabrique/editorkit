import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import type { Kertas } from "./engine";
import type { Answer, Lang, Table } from "./types";

export interface MeasureAttrs {
  table: string;
  column: number;
  columnName: string;
  measure: Answer["measure"];
  lang: Lang;
  text: string;
  missing: boolean;
}

export interface KertasMeasureOptions {
  engine: Kertas | null;
}

const measureKey = new PluginKey("kertasMeasure");

function splitLabel(text: string): [string, string] {
  const colon = text.indexOf(":");
  return colon > 0 ? [text.slice(0, colon + 1), text.slice(colon + 1)] : ["", text];
}

function tablesById(doc: PMNode): Map<string, Table> {
  const tables = new Map<string, Table>();
  doc.descendants((node) => {
    if (node.type.name === "collection" && typeof node.attrs.id === "string") tables.set(node.attrs.id, node.attrs.table as Table);
    return node.isBlock;
  });
  return tables;
}

function columnOf(table: Table, attrs: MeasureAttrs): number {
  const byName = table.columns.findIndex((column) => column.name === attrs.columnName);
  return byName >= 0 ? byName : attrs.column;
}

export function measureNode(schema: Schema, attrs: Omit<MeasureAttrs, "missing">): PMNode | null {
  const type = schema.nodes.kertasMeasure;
  const paragraph = schema.nodes.paragraph;
  if (!type || !paragraph) return null;
  return paragraph.create(null, type.create({ ...attrs, missing: false }));
}

export const KertasMeasure = Node.create<KertasMeasureOptions>({
  name: "kertasMeasure",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { engine: null };
  },

  addAttributes() {
    const plain = (name: keyof MeasureAttrs, html: string, fallback: unknown) => ({
      default: fallback,
      parseHTML: (element: HTMLElement) => {
        const raw = element.getAttribute(`data-${html}`);
        if (raw === null) return fallback;
        return typeof fallback === "number" ? Number(raw) : typeof fallback === "boolean" ? raw === "true" : raw;
      },
      renderHTML: (attributes: Record<string, unknown>) => ({ [`data-${html}`]: String(attributes[name]) }),
    });
    return {
      table: plain("table", "table", ""),
      column: plain("column", "column", 0),
      columnName: plain("columnName", "column-name", ""),
      measure: plain("measure", "measure", "sum"),
      lang: plain("lang", "lang", "fr"),
      text: plain("text", "text", ""),
      missing: plain("missing", "missing", false),
    };
  },

  parseHTML() {
    return [{ tag: "span[data-kertas-measure]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as MeasureAttrs;
    const [label, value] = splitLabel(attrs.text);
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-kertas-measure": "",
        class: `kertas-measure${attrs.missing ? " kertas-measure-missing" : ""}`,
        title: attrs.missing ? "Plus calculable : tableau ou colonne introuvable" : "Calculé en direct depuis le tableau",
      }),
      ["strong", label],
      value,
    ];
  },

  renderText({ node }) {
    return (node.attrs as MeasureAttrs).text;
  },

  addProseMirrorPlugins() {
    const { engine } = this.options;
    if (!engine) return [];
    return [
      new Plugin({
        key: measureKey,
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const tables = tablesById(state.doc);
          const tr = state.tr;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "kertasMeasure") return true;
            const attrs = node.attrs as MeasureAttrs;
            const table = tables.get(attrs.table);
            const column = table ? columnOf(table, attrs) : attrs.column;
            const answer = table ? engine.measure(table, column, attrs.measure, attrs.lang) : null;
            const next = {
              ...attrs,
              column,
              columnName: table?.columns[column]?.name ?? attrs.columnName,
              text: answer?.text ?? attrs.text,
              missing: !answer,
            };
            if (next.text !== attrs.text || next.missing !== attrs.missing || next.column !== attrs.column || next.columnName !== attrs.columnName) {
              tr.setNodeMarkup(pos, undefined, next);
            }
            return false;
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
