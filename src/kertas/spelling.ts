import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import type { Kertas } from "./engine";
import type { Lang } from "./types";

export interface Corrected {
  from: number;
  to: number;
  original: string;
  replacement: string;
}

export interface Flagged {
  from: number;
  to: number;
  word: string;
  lang: Lang;
}

export interface Inspected extends Flagged {
  suggestions: string[];
}

type Stepped<T> = T & { step: number };

export const ignoredKey = (word: string) => word.toLowerCase();

function plainText(node: PMNode): string {
  return node.textBetween(0, node.content.size, undefined, "\n");
}

export function spellBlock(
  engine: Kertas,
  tr: Transaction,
  pos: number,
  ignored: Set<string>,
  manual: Set<string>,
): { corrected: Stepped<Corrected>[]; flagged: Stepped<Flagged>[] } {
  const node = tr.doc.nodeAt(pos);
  const corrected: Stepped<Corrected>[] = [];
  const flagged: Stepped<Flagged>[] = [];
  if (!engine.spelling || !node || !node.isTextblock || node.type.spec.code) return { corrected, flagged };
  const code = tr.doc.type.schema.marks.code;
  for (const misspelling of [...engine.spell(plainText(node))].reverse()) {
    const from = pos + 1 + misspelling.from;
    const to = pos + 1 + misspelling.to;
    if (ignored.has(ignoredKey(misspelling.word))) continue;
    if (code && tr.doc.rangeHasMark(from, to, code)) continue;
    if (misspelling.correction && !manual.has(ignoredKey(misspelling.word))) {
      tr.insertText(misspelling.correction, from, to);
      const replacement = misspelling.correction;
      corrected.push({ from, to: from + replacement.length, original: misspelling.word, replacement, step: tr.steps.length });
    } else {
      flagged.push({ from, to, word: misspelling.word, lang: misspelling.lang, step: tr.steps.length });
    }
  }
  return { corrected, flagged };
}

export function settle<T extends { from: number; to: number }>(tr: Transaction, items: Stepped<T>[]): T[] {
  return items.map(({ step, ...item }) => {
    const later = tr.mapping.slice(step);
    return { ...(item as unknown as T), from: later.map(item.from, -1), to: later.map(item.to, 1) };
  });
}

export function trackCorrections(corrected: Corrected[], manual: Set<string>, tr: Transaction): { corrected: Corrected[]; manual: Set<string> } {
  if (!tr.docChanged) return { corrected, manual };
  const kept: Corrected[] = [];
  const nowManual = new Set(manual);
  for (const correction of corrected) {
    const from = tr.mapping.mapResult(correction.from, -1);
    const to = tr.mapping.mapResult(correction.to, 1);
    if (to.pos < from.pos) continue;
    const text = tr.doc.textBetween(from.pos, to.pos);
    if (text === correction.original) nowManual.add(ignoredKey(correction.original));
    if (text === correction.replacement) kept.push({ ...correction, from: from.pos, to: to.pos });
  }
  return { corrected: kept, manual: nowManual };
}

export function trackFlagged(flagged: Flagged[], tr: Transaction): Flagged[] {
  if (!tr.docChanged) return flagged;
  return flagged.flatMap((flag) => {
    const from = tr.mapping.mapResult(flag.from, 1);
    const to = tr.mapping.mapResult(flag.to, -1);
    if (from.deleted || to.deleted || to.pos <= from.pos) return [];
    return tr.doc.textBetween(from.pos, to.pos) === flag.word ? [{ ...flag, from: from.pos, to: to.pos }] : [];
  });
}

export function suggestionWidget(
  view: EditorView,
  inspected: Inspected,
  actions: { replace: (word: string) => void; ignore: () => void },
): HTMLElement {
  const menu = document.createElement("span");
  menu.className = "kertas-proposal kertas-suggestions";
  menu.contentEditable = "false";
  const button = (label: string, className: string, onPick: () => void) => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.textContent = label;
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      onPick();
      view.focus();
    });
    return element;
  };
  for (const suggestion of inspected.suggestions) {
    menu.append(button(suggestion, "kertas-proposal-accept", () => actions.replace(suggestion)));
  }
  if (inspected.suggestions.length === 0) {
    const none = document.createElement("span");
    none.className = "kertas-suggestions-none";
    none.textContent = "Aucune suggestion";
    menu.append(none);
  }
  menu.append(button("Ignorer", "kertas-proposal-dismiss", actions.ignore));
  return menu;
}
