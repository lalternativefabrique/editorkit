import { Extension, type InputRule, markInputRule, wrappingInputRule } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as PMNode, Slice } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import type { Kertas } from "./engine";
import { type MeasureAttrs, measureNode } from "./measure";
import { answerParagraph, blockNodes, isPlainParagraph } from "./nodes";
import { type Corrected, type Flagged, type Inspected, ignoredKey, settle, spellBlock, suggestionWidget, trackCorrections, trackFlagged } from "./spelling";
import { autoType, withoutEmptyTail } from "./tableOps";
import type { Emphasis, Table, Value } from "./types";

const PAUSE_MS = 400;
const BOLD_AFTER_APOSTROPHE = /(?<=['’(«])(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))$/;
const ITALIC_AFTER_APOSTROPHE = /(?<=['’(«])(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))$/;

export type Proposal =
  | { kind: "table"; from: number; to: number; table: Table; text: string; subject?: string | null; created?: boolean }
  | { kind: "heading"; from: number; to: number; text: string }
  | { kind: "list"; from: number; to: number; text: string; items: string[] }
  | { kind: "append"; from: number; to: number; text: string; collection: number; rows: Value[][] }
  | { kind: "answer"; from: number; to: number; text: string; answer: string; live: Omit<MeasureAttrs, "missing" | "text"> | null };

interface Emphasized {
  from: number;
  to: number;
  mark: Emphasis["mark"];
  text: string;
}

interface StructureState {
  dirty: number[];
  proposals: Proposal[];
  dismissed: Set<string>;
  emphasized: Emphasized[];
  refused: Set<string>;
  corrected: Corrected[];
  flagged: Flagged[];
  ignored: Set<string>;
  manual: Set<string>;
  inspected: Inspected | null;
}

type Meta =
  | {
      type: "normalized";
      processed: number[];
      emphasized: Emphasized[];
      corrected: Corrected[];
      flagged: Flagged[];
      checked: [number, number][];
    }
  | { type: "inspect"; inspected: Inspected | null }
  | { type: "ignore"; word: string }
  | { type: "proposed"; proposals: Proposal[] }
  | { type: "dismiss"; proposal: Proposal }
  | { type: "accepted"; proposal: Proposal };

export interface AutoStructureOptions {
  engine: Kertas | null;
  onMeasure?: (label: string, ms: number) => void;
}

export const autoStructureKey = new PluginKey<StructureState>("kertasAutoStructure");

function touchedBlocks(tr: Transaction): number[] {
  const starts = new Set<number>();
  tr.mapping.maps.forEach((map, index) => {
    const rest = tr.mapping.slice(index + 1);
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const size = tr.doc.content.size;
      const from = Math.max(0, Math.min(rest.map(newStart, -1), size - 1));
      const to = Math.min(size, Math.max(from + 1, rest.map(newEnd, 1)));
      tr.doc.nodesBetween(from, to, (node, pos) => {
        if (node.isTextblock) starts.add(pos);
        return !node.isTextblock;
      });
    });
  });
  return [...starts];
}

function plainText(node: PMNode): string {
  return node.textBetween(0, node.content.size, undefined, "\n");
}

function holdsCursor(state: EditorState, from: number, to: number): boolean {
  const head = state.selection.head;
  return head >= from && head <= to;
}

function mapProposal(proposal: Proposal, tr: Transaction): Proposal | null {
  const from = tr.mapping.mapResult(proposal.from, 1);
  const to = tr.mapping.mapResult(proposal.to, -1);
  if (from.deleted || to.deleted || to.pos <= from.pos) return null;
  if (proposal.kind === "append") {
    const collection = tr.mapping.mapResult(proposal.collection, 1);
    if (collection.deleted) return null;
    return { ...proposal, from: from.pos, to: to.pos, collection: collection.pos };
  }
  return { ...proposal, from: from.pos, to: to.pos };
}

function overlaps(proposal: Proposal, positions: number[]): boolean {
  return positions.some((pos) => pos >= proposal.from && pos < proposal.to);
}

function topLevelBlocks(doc: PMNode): { node: PMNode; pos: number }[] {
  const blocks: { node: PMNode; pos: number }[] = [];
  doc.forEach((node, pos) => blocks.push({ node, pos }));
  return blocks;
}

const handledKey = (text: string) => text.replace(/\s+/gu, " ").trim();

function proposalsAround(engine: Kertas, state: EditorState, around: number[], dismissed: Set<string>): Proposal[] {
  const blocks = topLevelBlocks(state.doc);
  const proposals: Proposal[] = [];
  const isPlainParagraph = (i: number) => blocks[i]?.node.type.name === "paragraph" && blocks[i].node.textContent.trim() !== "";
  const visited = new Set<number>();

  for (const pos of around) {
    const index = blocks.findIndex((b) => b.pos === pos);
    if (index < 0 || !isPlainParagraph(index) || visited.has(index)) continue;
    let first = index;
    let last = index;
    while (isPlainParagraph(first - 1)) first--;
    while (isPlainParagraph(last + 1)) last++;
    for (let i = first; i <= last; i++) visited.add(i);

    const from = blocks[first].pos;
    const to = blocks[last].pos + blocks[last].node.nodeSize;
    const stillTyping = holdsCursor(state, from, to);

    if (last > first && !stillTyping) {
      const text = blocks.slice(first, last + 1).map((b) => plainText(b.node)).join("\n");
      const block = engine.classify(text);
      if (block.kind === "table" && !dismissed.has(handledKey(text))) {
        proposals.push({ kind: "table", from, to, table: block.table, text });
        continue;
      }
      if (block.kind === "list" && block.ordered && !dismissed.has(handledKey(text))) {
        proposals.push({ kind: "list", from, to, text, items: block.items });
        continue;
      }
    }
    for (let i = first; i <= last; i++) {
      const blockFrom = blocks[i].pos;
      const blockTo = blockFrom + blocks[i].node.nodeSize;
      if (holdsCursor(state, blockFrom, blockTo)) continue;
      const text = plainText(blocks[i].node);
      const next = blocks[i + 1]?.node.textContent;
      if (dismissed.has(handledKey(text))) continue;
      const previous = blocks[i - 1];
      if (previous?.node.type.name === "collection") {
        const rows = engine.rowsFor(previous.node.attrs.table as Table, text);
        if (rows && rows.length > 0) {
          proposals.push({ kind: "append", from: blockFrom, to: blockTo, text, collection: previous.pos, rows });
          continue;
        }
      }
      const above = blocks
        .slice(Math.max(0, i - 3), i)
        .reverse()
        .find((b) => b.node.type.name === "collection");
      const aboveTable = above?.node.attrs.table as Table | undefined;
      const answered = blocks[i + 1]?.node.firstChild?.type.name === "kertasMeasure";
      const answer = aboveTable && !answered ? engine.answer(aboveTable, text) : null;
      if (answer && aboveTable) {
        const id = above?.node.attrs.id as string | null | undefined;
        const live = id
          ? { table: id, column: answer.column, columnName: aboveTable.columns[answer.column]?.name ?? "", measure: answer.measure, lang: answer.lang }
          : null;
        proposals.push({ kind: "answer", from: blockFrom, to: blockTo, text, answer: answer.text, live });
        continue;
      }
      const block = engine.classify(text, next);
      if (block.kind === "heading") proposals.push({ kind: "heading", from: blockFrom, to: blockTo, text });
      if (block.kind === "table") proposals.push({ kind: "table", from: blockFrom, to: blockTo, table: block.table, text });
      if (block.kind === "create_table") {
        proposals.push({ kind: "table", from: blockFrom, to: blockTo, table: block.table, text, subject: block.subject, created: true });
      }
    }
  }
  return proposals;
}

const sameWords = (text: string) => text.replace(/\s+/gu, " ");
const emphasisKey = (emphasis: { mark: string; text: string }) => `${emphasis.mark}:${sameWords(emphasis.text)}`;

function hasMarks(doc: PMNode, from: number, to: number): boolean {
  let marked = false;
  doc.nodesBetween(from, to, (node) => {
    if (node.isText && node.marks.length > 0) marked = true;
  });
  return marked;
}

function emphasizeBlock(engine: Kertas, tr: Transaction, pos: number, refused: Set<string>): (Emphasized & { step: number })[] {
  const node = tr.doc.nodeAt(pos);
  if (!node || node.type.name !== "paragraph") return [];
  const applied: (Emphasized & { step: number })[] = [];
  for (const emphasis of engine.emphasize(plainText(node))) {
    const type = tr.doc.type.schema.marks[emphasis.mark];
    const from = pos + 1 + emphasis.from;
    const to = pos + 1 + emphasis.to;
    const text = tr.doc.textBetween(from, to);
    if (!type || refused.has(emphasisKey({ mark: emphasis.mark, text })) || hasMarks(tr.doc, from, to)) continue;
    tr.addMark(from, to, type.create());
    applied.push({ from, to, mark: emphasis.mark, text, step: tr.steps.length });
  }
  return applied;
}

function checkEmphasized(emphasized: Emphasized[], refused: Set<string>, tr: Transaction): { emphasized: Emphasized[]; refused: Set<string> } {
  if (!tr.docChanged) return { emphasized, refused };
  const kept: Emphasized[] = [];
  const nowRefused = new Set(refused);
  for (const emphasis of emphasized) {
    const from = tr.mapping.mapResult(emphasis.from, 1);
    const to = tr.mapping.mapResult(emphasis.to, -1);
    if (from.deleted || to.deleted || to.pos <= from.pos) continue;
    if (sameWords(tr.doc.textBetween(from.pos, to.pos)) !== sameWords(emphasis.text)) continue;
    const type = tr.doc.type.schema.marks[emphasis.mark];
    if (type && !tr.doc.rangeHasMark(from.pos, to.pos, type)) {
      nowRefused.add(emphasisKey(emphasis));
      continue;
    }
    kept.push({ ...emphasis, from: from.pos, to: to.pos });
  }
  return { emphasized: kept, refused: nowRefused };
}

export interface TidyMemory {
  refused: Set<string>;
  ignored: Set<string>;
  manual: Set<string>;
}

const NOTHING_REMEMBERED: TidyMemory = { refused: new Set(), ignored: new Set(), manual: new Set() };

export function tidyBlock(
  engine: Kertas,
  tr: Transaction,
  pos: number,
  memory: TidyMemory = NOTHING_REMEMBERED,
): { corrected: (Corrected & { step: number })[]; flagged: (Flagged & { step: number })[]; emphasized: (Emphasized & { step: number })[] } {
  const node = tr.doc.nodeAt(pos);
  if (!node || !node.isTextblock || node.type.spec.code) return { corrected: [], flagged: [], emphasized: [] };
  const base = pos + 1;
  const code = tr.doc.type.schema.marks.code;
  for (const edit of [...engine.normalize(plainText(node))].reverse()) {
    const from = base + edit.from;
    const to = base + edit.to;
    if (code && tr.doc.rangeHasMark(Math.max(base, from - 1), Math.max(to, from + 1), code)) continue;
    tr.insertText(edit.insert, from, to);
  }
  const spelled = spellBlock(engine, tr, pos, memory.ignored, memory.manual);
  return { ...spelled, emphasized: emphasizeBlock(engine, tr, pos, memory.refused) };
}

function normalizeLeftBlocks(engine: Kertas, view: EditorView): boolean {
  const { state } = view;
  const plugin = autoStructureKey.getState(state);
  if (!plugin || plugin.dirty.length === 0) return false;

  const processed: number[] = [];
  const emphasized: (Emphasized & { step: number })[] = [];
  const corrected: (Corrected & { step: number })[] = [];
  const flagged: (Flagged & { step: number })[] = [];
  const tr = state.tr;
  for (const pos of [...plugin.dirty].sort((a, b) => b - a)) {
    const node = state.doc.nodeAt(pos);
    if (!node || !node.isTextblock || node.type.spec.code) {
      processed.push(pos);
      continue;
    }
    if (holdsCursor(state, pos, pos + node.nodeSize)) continue;
    processed.push(pos);
    const tidied = tidyBlock(engine, tr, pos, plugin);
    corrected.push(...tidied.corrected);
    flagged.push(...tidied.flagged);
    emphasized.push(...tidied.emphasized);
  }
  if (processed.length === 0) return false;

  tr.setMeta(autoStructureKey, {
    type: "normalized",
    processed: processed.map((p) => tr.mapping.map(p)),
    emphasized: emphasized.map(({ step, ...emphasis }) => {
      const later = tr.mapping.slice(step);
      return { ...emphasis, from: later.map(emphasis.from, 1), to: later.map(emphasis.to, -1) };
    }),
    corrected: settle(tr, corrected),
    flagged: settle(tr, flagged),
    checked: processed.map((p) => {
      const start = tr.mapping.map(p);
      return [start, start + (tr.doc.nodeAt(start)?.nodeSize ?? 0)];
    }),
  } satisfies Meta);
  if (tr.docChanged) closeHistory(tr);
  view.dispatch(tr);

  const after = view.state;
  const fresh = autoStructureKey.getState(after);
  const proposals = proposalsAround(engine, after, processed.map((p) => tr.mapping.map(p)), fresh?.dismissed ?? new Set());
  const kept = (fresh?.proposals ?? []).filter((p) => !proposals.some((n) => n.from < p.to && p.from < n.to));
  view.dispatch(after.tr.setMeta(autoStructureKey, { type: "proposed", proposals: [...kept, ...proposals] } satisfies Meta).setMeta("addToHistory", false));
  return true;
}

export function acceptProposal(view: EditorView, proposal: Proposal, engine?: Kertas | null): void {
  const { schema } = view.state;
  const tr = view.state.tr;
  closeHistory(tr);
  if (proposal.kind === "answer") {
    const paragraph = (proposal.live && measureNode(schema, { ...proposal.live, text: proposal.answer })) || answerParagraph(schema, proposal.answer);
    if (!paragraph) return;
    tr.insert(proposal.to, paragraph);
  } else if (proposal.kind === "append") {
    const collection = view.state.doc.nodeAt(proposal.collection);
    if (!collection || collection.type.name !== "collection") return;
    const table = collection.attrs.table as Table;
    const kept = withoutEmptyTail(table);
    const grown = { ...kept, rows: [...kept.rows, ...proposal.rows] };
    tr.delete(proposal.from, proposal.to);
    tr.setNodeMarkup(proposal.collection, undefined, { ...collection.attrs, table: engine ? autoType(engine, grown) : grown });
  } else if (proposal.kind === "table") {
    const collection = schema.nodes.collection;
    if (!collection) return;
    tr.replaceWith(proposal.from, proposal.to, collection.create({ table: proposal.table }));
  } else if (proposal.kind === "list") {
    const { orderedList, listItem, paragraph } = schema.nodes;
    if (!orderedList || !listItem || !paragraph) return;
    const items = proposal.items.map((item) => listItem.create(null, paragraph.create(null, schema.text(item))));
    tr.replaceWith(proposal.from, proposal.to, orderedList.create(null, items));
  } else {
    const heading = schema.nodes.heading;
    if (!heading) return;
    tr.setBlockType(proposal.from, proposal.to, heading, { level: 2 });
  }
  tr.setMeta(autoStructureKey, { type: "accepted", proposal } satisfies Meta);
  view.dispatch(tr);
  view.focus();
}

function proposalLabel(proposal: Proposal): string {
  if (proposal.kind === "heading") return "Faire un titre";
  if (proposal.kind === "list") return `Faire une liste numérotée · ${proposal.items.length} éléments`;
  if (proposal.kind === "answer") return `Répondre · ${proposal.answer}`;
  if (proposal.kind === "append") return proposal.rows.length > 1 ? `Ajouter ${proposal.rows.length} lignes au tableau` : "Ajouter au tableau";
  const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? "s" : ""}`;
  const size = `${plural(proposal.table.columns.length, "colonne")}, ${plural(proposal.table.rows.length, "ligne")}`;
  return `${proposal.created ? "Créer" : "Faire"} un tableau · ${size}`;
}

function proposalWidget(view: EditorView, proposal: Proposal, engine: Kertas): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "kertas-proposal";
  chip.contentEditable = "false";

  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "kertas-proposal-accept";
  accept.textContent = proposalLabel(proposal);
  if (proposal.kind === "table" && proposal.subject) accept.title = `Le contenu « ${proposal.subject} » demandera l'IA : le tableau est créé vide.`;
  accept.addEventListener("mousedown", (event) => {
    event.preventDefault();
    acceptProposal(view, proposal, engine);
  });

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "kertas-proposal-dismiss";
  dismiss.textContent = "×";
  dismiss.title = "Laisser tel quel";
  dismiss.addEventListener("mousedown", (event) => {
    event.preventDefault();
    view.dispatch(view.state.tr.setMeta(autoStructureKey, { type: "dismiss", proposal } satisfies Meta).setMeta("addToHistory", false));
  });

  chip.append(accept, dismiss);
  return chip;
}

export const AutoStructure = Extension.create<AutoStructureOptions>({
  name: "kertasAutoStructure",

  addOptions() {
    return { engine: null, onMeasure: undefined };
  },

  addInputRules() {
    const { bulletList, orderedList } = this.editor.schema.nodes;
    const { bold, italic } = this.editor.schema.marks;
    const rules: InputRule[] = [];
    if (bold) rules.push(markInputRule({ find: BOLD_AFTER_APOSTROPHE, type: bold }));
    if (italic) rules.push(markInputRule({ find: ITALIC_AFTER_APOSTROPHE, type: italic }));
    if (bulletList) rules.push(wrappingInputRule({ find: /^\s*([•–—])\s$/, type: bulletList }));
    if (orderedList) {
      rules.push(
        wrappingInputRule({
          find: /^(\d+)\)\s$/,
          type: orderedList,
          getAttributes: (match) => ({ start: Number(match[1]) }),
          joinPredicate: (match, node) => node.childCount + Number(node.attrs.start) === Number(match[1]),
        }),
      );
    }
    return rules;
  },

  addProseMirrorPlugins() {
    const { engine, onMeasure } = this.options;
    if (!engine) return [];

    return [
      new Plugin<StructureState>({
        key: autoStructureKey,
        state: {
          init: () => ({
            dirty: [],
            proposals: [],
            dismissed: new Set(),
            emphasized: [],
            refused: new Set(),
            corrected: [],
            flagged: [],
            ignored: new Set(),
            manual: new Set(),
            inspected: null,
          }),
          apply(tr, value) {
            const meta = tr.getMeta(autoStructureKey) as Meta | undefined;
            let dirty = value.dirty.map((pos) => tr.mapping.map(pos));
            let proposals = value.proposals.map((p) => mapProposal(p, tr)).filter((p): p is Proposal => p !== null);
            let dismissed = value.dismissed;
            const checked = checkEmphasized(value.emphasized, value.refused, tr);
            let emphasized = checked.emphasized;
            const corrections = trackCorrections(value.corrected, value.manual, tr);
            let corrected = corrections.corrected;
            let ignored = value.ignored;
            let flagged = trackFlagged(value.flagged, tr);
            let inspected = tr.docChanged ? null : value.inspected;

            const loaded = tr.getMeta("preventUpdate") === true;
            if (tr.docChanged && meta?.type !== "normalized" && !loaded) {
              const touched = touchedBlocks(tr);
              dirty = [...dirty, ...touched];
              proposals = proposals.filter((p) => !overlaps(p, touched));
            }
            if (meta?.type === "normalized") {
              dirty = dirty.filter((pos) => !meta.processed.includes(pos));
              emphasized = [...emphasized, ...meta.emphasized];
              corrected = [...corrected, ...meta.corrected];
              flagged = [...flagged.filter((f) => !meta.checked.some(([from, to]) => f.from >= from && f.to <= to)), ...meta.flagged];
            }
            if (meta?.type === "inspect") inspected = meta.inspected;
            if (meta?.type === "ignore") {
              ignored = new Set([...ignored, ignoredKey(meta.word)]);
              flagged = flagged.filter((f) => ignoredKey(f.word) !== ignoredKey(meta.word));
              inspected = null;
            }
            if (meta?.type === "proposed") proposals = meta.proposals;
            if (meta?.type === "dismiss" || meta?.type === "accepted") {
              proposals = proposals.filter((p) => p.from !== meta.proposal.from);
            }
            if (meta?.type === "dismiss" || meta?.type === "accepted") {
              const handled = meta.proposal.kind === "answer" ? [meta.proposal.text, meta.proposal.answer] : [meta.proposal.text];
              dismissed = new Set([...dismissed, ...handled.map(handledKey)]);
            }
            return { dirty: [...new Set(dirty)], proposals, dismissed, emphasized, refused: checked.refused, corrected, flagged, ignored, manual: corrections.manual, inspected };
          },
        },
        props: {
          attributes: (): Record<string, string> => (engine.spelling ? { spellcheck: "false" } : {}),
          handleClick(view, pos) {
            const plugin = autoStructureKey.getState(view.state);
            if (!plugin) return false;
            const flag = plugin.flagged.find((f) => pos >= f.from && pos <= f.to);
            if (!flag && !plugin.inspected) return false;
            if (flag && plugin.inspected?.from === flag.from && plugin.inspected.word === flag.word) return false;
            const started = performance.now();
            const inspected = flag ? { ...flag, suggestions: engine.suggest(flag.word, flag.lang) } : null;
            if (flag) onMeasure?.("suggestions orthographe", performance.now() - started);
            view.dispatch(view.state.tr.setMeta(autoStructureKey, { type: "inspect", inspected } satisfies Meta).setMeta("addToHistory", false));
            return false;
          },
          decorations(state) {
            const plugin = autoStructureKey.getState(state);
            const proposals = plugin?.proposals ?? [];
            const inspected = plugin?.inspected;
            const spellingDecorations = [
              ...(plugin?.flagged ?? []).map((f) => Decoration.inline(f.from, f.to, { class: "kertas-misspelled" })),
              ...(plugin?.corrected ?? []).map((c) =>
                Decoration.inline(c.from, c.to, { class: "kertas-corrected", title: `Corrigé automatiquement (était « ${c.original} »)` }),
              ),
              ...(inspected
                ? [
                    Decoration.widget(
                      inspected.to,
                      (view) =>
                        suggestionWidget(view, inspected, {
                          replace: (word) => view.dispatch(view.state.tr.insertText(word, inspected.from, inspected.to)),
                          ignore: () =>
                            view.dispatch(
                              view.state.tr.setMeta(autoStructureKey, { type: "ignore", word: inspected.word } satisfies Meta).setMeta("addToHistory", false),
                            ),
                        }),
                      { side: 1, key: `suggest:${inspected.from}:${inspected.word}`, ignoreSelection: true },
                    ),
                  ]
                : []),
            ];
            return DecorationSet.create(state.doc, [
              ...spellingDecorations,
              ...proposals.flatMap((proposal) => [
                Decoration.node(proposal.from, proposal.from + (state.doc.nodeAt(proposal.from)?.nodeSize ?? 0), { class: "kertas-proposed-start" }),
                Decoration.widget(proposal.from + 1, (view) => proposalWidget(view, proposal, engine), {
                  side: -1,
                  key: `${proposal.kind}:${proposal.from}:${proposal.text.length}`,
                  ignoreSelection: true,
                }),
              ]),
            ]);
          },
          handlePaste(view, event) {
            const text = event.clipboardData?.getData("text/plain") ?? "";
            if (!text.trim()) return false;
            const html = event.clipboardData?.getData("text/html") ?? "";
            const started = performance.now();
            const blocks = engine.parse(text);
            const hasTable = blocks.some((block) => block.kind === "table");
            if ((html && !hasTable) || isPlainParagraph(blocks)) return false;
            const nodes = blockNodes(view.state.schema, blocks);
            const paragraph = view.state.schema.nodes.paragraph;
            const tail = nodes[nodes.length - 1];
            if (paragraph && tail && (!tail.isTextblock || tail.type.spec.code)) nodes.push(paragraph.create());
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            if (!first || !last) return false;
            const open = (node: PMNode) => (node.type.name === "paragraph" ? 1 : 0);
            const slice = new Slice(Fragment.fromArray(nodes), open(first), open(last));
            view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
            requestAnimationFrame(() => setTimeout(() => onMeasure?.("collage → mise en forme", performance.now() - started)));
            return true;
          },
        },
        view() {
          let timer: ReturnType<typeof setTimeout> | undefined;
          return {
            update(view) {
              clearTimeout(timer);
              timer = setTimeout(() => {
                const started = performance.now();
                if (normalizeLeftBlocks(engine, view)) onMeasure?.("passe de structuration", performance.now() - started);
              }, PAUSE_MS);
            },
            destroy() {
              clearTimeout(timer);
            },
          };
        },
      }),
    ];
  },
});
