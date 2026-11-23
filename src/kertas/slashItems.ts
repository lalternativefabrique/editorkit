import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

import type { SlashItem } from "../index";
import { tidyBlock } from "./AutoStructure";
import type { Kertas } from "./engine";
import { measureNode } from "./measure";
import { answerParagraph } from "./nodes";
import { EMPTY_VALUE } from "./tableOps";
import type { Answer, Lang, Table } from "./types";

type Measure = Answer["measure"];

export interface KertasSlashLabels {
  table: string;
  chart: string;
  tidy: string;
  measures: Record<Measure, string>;
  tableDescription: string;
  chartDescription: string;
  measureDescription: string;
  tidyDescription: string;
}

export const defaultKertasSlashLabels: KertasSlashLabels = {
  table: "Tableau",
  chart: "Graphique",
  tidy: "Corriger le paragraphe",
  measures: {
    sum: "Total",
    mean: "Moyenne",
    median: "Médiane",
    max: "Maximum",
    min: "Minimum",
    count: "Nombre de lignes",
  },
  tableDescription: "Grille vide, ou le texte de la ligne mis en tableau",
  chartDescription: "Graphique du tableau au-dessus",
  measureDescription: "Calculé sur le tableau au-dessus",
  tidyDescription: "Typographie, orthographe et mise en forme, tout de suite",
};

const QUESTIONS: Record<Lang, Record<Measure, string>> = {
  fr: { sum: "total", mean: "moyenne", median: "médiane", max: "maximum", min: "minimum", count: "nombre de lignes" },
  en: { sum: "total", mean: "average", median: "median", max: "maximum", min: "minimum", count: "number of rows" },
};


const EMPTY_SIZE = 3;

function topLevelIndex(editor: Editor): number {
  return editor.state.selection.$from.index(0);
}

function tableAbove(editor: Editor): { node: PMNode; pos: number } | null {
  const blocks: { node: PMNode; pos: number }[] = [];
  editor.state.doc.forEach((node, pos) => blocks.push({ node, pos }));
  return (
    blocks
      .slice(0, topLevelIndex(editor) + 1)
      .reverse()
      .find((block) => block.node.type.name === "collection") ?? null
  );
}

function emptyTable(lang: Lang): Table {
  const name = lang === "en" ? "Column" : "Colonne";
  return {
    columns: Array.from({ length: EMPTY_SIZE }, (_, i) => ({ name: `${name} ${i + 1}`, property: { type: "text" } })),
    rows: Array.from({ length: EMPTY_SIZE }, () => Array.from({ length: EMPTY_SIZE }, () => EMPTY_VALUE)),
  };
}

function currentLine(editor: Editor): { from: number; to: number; text: string; empty: boolean; topLevel: boolean } {
  const { $from } = editor.state.selection;
  const block = $from.parent;
  return {
    from: $from.before(),
    to: $from.after(),
    text: block.textContent.trim(),
    empty: block.childCount === 0,
    topLevel: $from.depth === 1 && block.type.name === "paragraph",
  };
}

function insertTable(engine: Kertas, editor: Editor): void {
  const line = currentLine(editor);
  const block = line.text ? engine.classify(line.text) : null;
  const table = block?.kind === "table" || block?.kind === "create_table" ? block.table : emptyTable(engine.language);
  const nodes = [{ type: "collection", attrs: { table } }, { type: "paragraph" }];
  const replaceLine = line.topLevel && (line.empty || block?.kind === "table" || block?.kind === "create_table");
  const at = replaceLine ? { from: line.from, to: line.to } : editor.state.selection.$from.after(1);
  editor.chain().focus().insertContentAt(at, nodes).run();
}

function addChart(engine: Kertas, editor: Editor): void {
  const above = tableAbove(editor);
  if (!above) return;
  const chart = engine.chart(above.node.attrs.table as Table);
  if (!chart) return;
  const { tr } = editor.state;
  tr.setNodeMarkup(above.pos, undefined, { ...above.node.attrs, chart: { x: chart.x, y: chart.y } });
  editor.view.dispatch(tr);
}

function insertMeasure(engine: Kertas, editor: Editor, measure: Measure): void {
  const above = tableAbove(editor);
  if (!above) return;
  const table = above.node.attrs.table as Table;
  const answer = engine.answer(table, QUESTIONS[engine.language][measure]);
  if (!answer) return;
  const id = above.node.attrs.id as string | null;
  const live = id
    ? measureNode(editor.schema, {
        table: id,
        column: answer.column,
        columnName: table.columns[answer.column]?.name ?? "",
        measure: answer.measure,
        lang: answer.lang,
        text: answer.text,
      })
    : null;
  const paragraph = live ?? answerParagraph(editor.schema, answer.text);
  if (!paragraph) return;
  const line = currentLine(editor);
  const { tr } = editor.state;
  const at = line.topLevel && line.empty ? line.from : editor.state.selection.$from.after(1);
  if (line.topLevel && line.empty) tr.delete(line.from, line.to);
  const next = editor.schema.nodes.paragraph?.create();
  tr.insert(at, next ? [paragraph, next] : [paragraph]);
  if (next) tr.setSelection(TextSelection.create(tr.doc, at + paragraph.nodeSize + 1));
  editor.view.dispatch(tr.scrollIntoView());
}

function tidyLine(engine: Kertas, editor: Editor): void {
  const { tr } = editor.state;
  tidyBlock(engine, tr, editor.state.selection.$from.before());
  if (tr.docChanged) editor.view.dispatch(tr);
}

export function kertasSlashItems(engine: Kertas, labels: KertasSlashLabels = defaultKertasSlashLabels): SlashItem[] {
  const item = (id: string, title: string, description: string, run: (editor: Editor) => void): SlashItem => ({
    id,
    title,
    description,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      run(editor);
    },
  });
  const measures: Measure[] = ["sum", "mean", "median", "max", "min", "count"];
  return [
    item("kertas-table", labels.table, labels.tableDescription, (editor) => insertTable(engine, editor)),
    item("kertas-chart", labels.chart, labels.chartDescription, (editor) => addChart(engine, editor)),
    ...measures.map((measure) =>
      item(`kertas-${measure}`, labels.measures[measure], labels.measureDescription, (editor) =>
        insertMeasure(engine, editor, measure),
      ),
    ),
    item("kertas-tidy", labels.tidy, labels.tidyDescription, (editor) => tidyLine(engine, editor)),
  ];
}
