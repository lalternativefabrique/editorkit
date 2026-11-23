import type { Kertas } from "./engine";

type Attrs = Record<string, unknown>;

export interface DocNode {
  type: string;
  attrs?: Attrs;
  content?: DocNode[];
  text?: string;
  marks?: Attrs[];
}

export type RowKind = "paragraph" | "heading" | "bullet" | "ordered" | "task" | "quote" | "code" | "callout" | "divider" | "locked";

/**
 * One line of a document as a native editor shows it: a text block edited as
 * inline Markdown, a list item flattened with its depth, or a block it cannot
 * edit yet, kept exactly as stored.
 */
export interface Row {
  id: string;
  kind: RowKind;
  text: string;
  level?: number;
  depth?: number;
  checked?: boolean;
  /** The block's attributes; for a list item, the item's. */
  attrs?: Attrs;
  /** The paragraph inside a list item, a quote or a callout. */
  inner?: Attrs;
  /** The list holding the item: a new list starts where these change. */
  list?: Attrs;
  /** Each link's full attributes by its address, which inline Markdown does not carry. */
  links?: Record<string, Attrs>;
  node?: DocNode;
}

const LISTS: Record<string, { kind: RowKind; item: string }> = {
  bulletList: { kind: "bullet", item: "listItem" },
  orderedList: { kind: "ordered", item: "listItem" },
  taskList: { kind: "task", item: "taskItem" },
};
const LIST_OF: Partial<Record<RowKind, string>> = { bullet: "bulletList", ordered: "orderedList", task: "taskList" };
const TEXT_KINDS: RowKind[] = ["paragraph", "heading", "bullet", "ordered", "task", "quote", "code", "callout"];

export const isText = (row: Row) => TEXT_KINDS.includes(row.kind);
export const isListed = (row: Row) => row.kind === "bullet" || row.kind === "ordered" || row.kind === "task";

export function newBlockId(): string {
  const random = globalThis.crypto?.randomUUID;
  if (random) return random.call(globalThis.crypto);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const n = (Math.random() * 16) | 0;
    return (c === "x" ? n : (n & 0x3) | 0x8).toString(16);
  });
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = (value: object) => Object.keys(value).filter((key) => (value as Attrs)[key] !== undefined);
  const left = keys(a);
  const right = keys(b);
  return left.length === right.length && left.every((key) => same((a as Attrs)[key], (b as Attrs)[key]));
}
const idOf = (attrs: Attrs | undefined) => (typeof attrs?.id === "string" ? attrs.id : newBlockId());
const paragraphDoc = (content: DocNode[] | undefined): DocNode => ({ type: "doc", content: [{ type: "paragraph", content }] });

const isLink = (mark: Attrs) => mark.type === "link" && typeof (mark.attrs as Attrs | undefined)?.href === "string";
const hrefOf = (mark: Attrs) => (mark.attrs as Attrs).href as string;

function linksOf(content: DocNode[]): Record<string, Attrs> | undefined {
  const links: Record<string, Attrs> = {};
  for (const node of content) for (const mark of node.marks ?? []) if (isLink(mark)) links[hrefOf(mark)] = mark.attrs as Attrs;
  return Object.keys(links).length ? links : undefined;
}

function withLinks(content: DocNode[] | undefined, links: Record<string, Attrs> | undefined): DocNode[] | undefined {
  if (!content || !links) return content;
  return content.map((node) =>
    node.marks?.some(isLink) ? { ...node, marks: node.marks.map((mark) => (isLink(mark) && links[hrefOf(mark)] ? { ...mark, attrs: links[hrefOf(mark)] } : mark)) } : node,
  );
}

/** The inline Markdown of a paragraph's content, or null when Markdown and the kept link attributes cannot carry it back unchanged. */
function inlineOf(engine: Kertas, content: DocNode[] | undefined): { text: string; links?: Record<string, Attrs> } | null {
  if (!content?.length) return { text: "" };
  const text = engine.toMarkdown(paragraphDoc(content)).trim();
  const links = linksOf(content);
  return same(withLinks(contentOf(engine, text), links), content) ? { text, links } : null;
}

function contentOf(engine: Kertas, text: string): DocNode[] | undefined {
  if (text === "") return undefined;
  const parsed = engine.fromMarkdown(text) as unknown as DocNode;
  const blocks = parsed.content ?? [];
  if (blocks.length === 1 && blocks[0].type === "paragraph") return blocks[0].content;
  return [{ type: "text", text }];
}

const locked = (node: DocNode): Row => ({ id: idOf(node.attrs), kind: "locked", text: "", node });

function single(node: DocNode): DocNode | null {
  const only = node.content?.length === 1 ? node.content[0] : null;
  return only?.type === "paragraph" ? only : null;
}

function listRows(engine: Kertas, list: DocNode, depth: number): Row[] | null {
  const family = LISTS[list.type];
  const rows: Row[] = [];
  for (const item of list.content ?? []) {
    const [first, nested, ...rest] = item.content ?? [];
    if (item.type !== family.item || first?.type !== "paragraph" || rest.length > 0) return null;
    const inline = inlineOf(engine, first.content);
    if (inline === null) return null;
    rows.push({
      id: idOf(item.attrs),
      kind: family.kind,
      ...inline,
      depth,
      checked: family.kind === "task" ? Boolean(item.attrs?.checked) : undefined,
      attrs: item.attrs,
      inner: first.attrs,
      list: list.attrs,
    });
    if (nested) {
      if (!LISTS[nested.type] || (nested.type === "taskList") !== (list.type === "taskList")) return null;
      const children = listRows(engine, nested, depth + 1);
      if (!children) return null;
      rows.push(...children);
    }
  }
  return rows;
}

function blockRows(engine: Kertas, node: DocNode): Row[] {
  const id = idOf(node.attrs);
  switch (node.type) {
    case "paragraph":
    case "heading": {
      const inline = inlineOf(engine, node.content);
      if (inline === null) return [locked(node)];
      const level = node.type === "heading" ? Number(node.attrs?.level ?? 1) : undefined;
      return [{ id, kind: node.type, ...inline, level, attrs: node.attrs }];
    }
    case "horizontalRule":
      return [{ id, kind: "divider", text: "", attrs: node.attrs }];
    case "codeBlock": {
      const parts = node.content ?? [];
      if (parts.some((part) => part.type !== "text" || part.marks?.length)) return [locked(node)];
      return [{ id, kind: "code", text: parts.map((part) => part.text ?? "").join(""), attrs: node.attrs }];
    }
    case "blockquote":
    case "callout": {
      const inner = single(node);
      const inline = inner ? inlineOf(engine, inner.content) : null;
      if (!inner || inline === null) return [locked(node)];
      return [{ id, kind: node.type === "blockquote" ? "quote" : "callout", ...inline, attrs: node.attrs, inner: inner.attrs }];
    }
    default:
      if (LISTS[node.type]) return listRows(engine, node, 0) ?? [locked(node)];
      return [locked(node)];
  }
}

export function toRows(engine: Kertas, document: DocNode): Row[] {
  const rows = (document.content ?? []).flatMap((node) => blockRows(engine, node));
  return rows.length > 0 ? rows : [paragraphRow()];
}

export function paragraphRow(text = ""): Row {
  return { id: newBlockId(), kind: "paragraph", text };
}

const withId = (attrs: Attrs | undefined, id: string): Attrs => ({ ...attrs, id });

function paragraph(engine: Kertas, text: string, attrs: Attrs | undefined, links?: Record<string, Attrs>): DocNode {
  const content = withLinks(contentOf(engine, text), links);
  return { type: "paragraph", attrs: withId(attrs, idOf(attrs)), ...(content ? { content } : {}) };
}

function listNode(engine: Kertas, rows: Row[], start: number, depth: number): { node: DocNode; next: number } {
  const head = rows[start];
  const type = LIST_OF[head.kind] as string;
  const items: DocNode[] = [];
  let i = start;
  while (i < rows.length) {
    const row = rows[i];
    if (!isListed(row) || (row.depth ?? 0) < depth) break;
    if ((row.depth ?? 0) === depth && (LIST_OF[row.kind] !== type || (i > start && !same(row.list, head.list)))) break;
    if ((row.depth ?? 0) > depth) {
      const nested = listNode(engine, rows, i, depth + 1);
      items[items.length - 1]?.content?.push(nested.node);
      i = nested.next;
      continue;
    }
    const attrs = withId(row.attrs, row.id);
    if (row.kind === "task") attrs.checked = Boolean(row.checked);
    items.push({ type: LISTS[type].item, attrs, content: [paragraph(engine, row.text, row.inner, row.links)] });
    i++;
  }
  return { node: { type, attrs: withId(head.list, idOf(head.list)), content: items }, next: i };
}

function rowNode(engine: Kertas, row: Row): DocNode {
  const attrs = withId(row.attrs, row.id);
  switch (row.kind) {
    case "heading":
      return { ...paragraph(engine, row.text, attrs, row.links), type: "heading", attrs: { ...attrs, level: row.level ?? 1 } };
    case "divider":
      return { type: "horizontalRule", attrs };
    case "code":
      return { type: "codeBlock", attrs, ...(row.text ? { content: [{ type: "text", text: row.text }] } : {}) };
    case "quote":
      return { type: "blockquote", attrs, content: [paragraph(engine, row.text, row.inner, row.links)] };
    case "callout":
      return { type: "callout", attrs: { tone: "note", ...attrs }, content: [paragraph(engine, row.text, row.inner, row.links)] };
    case "locked":
      return row.node as DocNode;
    default:
      return paragraph(engine, row.text, attrs, row.links);
  }
}

function levelled(rows: Row[]): Row[] {
  const out: Row[] = [];
  for (const row of rows) {
    const above = out[out.length - 1];
    const max = above && isListed(above) ? (above.depth ?? 0) + 1 : 0;
    out.push(isListed(row) && (row.depth ?? 0) > max ? { ...row, depth: max } : row);
  }
  return out;
}

export function toDocument(engine: Kertas, written: Row[], base?: DocNode): DocNode {
  const rows = levelled(written);
  const content: DocNode[] = [];
  let i = 0;
  while (i < rows.length) {
    if (isListed(rows[i])) {
      const built = listNode(engine, rows, i, 0);
      content.push(built.node);
      i = built.next;
    } else {
      content.push(rowNode(engine, rows[i]));
      i++;
    }
  }
  return { ...base, type: "doc", content };
}

/** A row turned into another kind, keeping its id and text. */
export function convert(row: Row, kind: RowKind, level?: number): Row {
  const next: Row = { id: row.id, kind, text: kind === "divider" ? "" : row.text };
  if (row.links && kind !== "divider") next.links = row.links;
  if (kind === "heading") next.level = level ?? 1;
  if (isListed(next)) {
    next.depth = isListed(row) ? row.depth : 0;
    if (kind === "task") next.checked = false;
  }
  return next;
}

const SHORTCUTS: [RegExp, RowKind, number?][] = [
  [/^### /, "heading", 3],
  [/^## /, "heading", 2],
  [/^# /, "heading", 1],
  [/^\[ ?\] /, "task"],
  [/^[-*] /, "bullet"],
  [/^1[.)] /, "ordered"],
  [/^> /, "quote"],
  [/^```$/, "code"],
  [/^---$/, "divider"],
];

/** The kind a paragraph's opening characters ask for, as Markdown would read them, and the text left once they are consumed. */
export function shortcut(row: Row): Row | null {
  if (row.kind !== "paragraph") return null;
  for (const [pattern, kind, level] of SHORTCUTS) {
    const match = pattern.exec(row.text);
    if (match) return { ...convert(row, kind, level), text: kind === "divider" ? "" : row.text.slice(match[0].length) };
  }
  return null;
}

export interface Edit {
  rows: Row[];
  focus: number;
  caret: number;
}

/** Return pressed in a row with its text cut at the caret: lists and tasks continue, an empty item leaves the list. */
export function split(rows: Row[], index: number, before: string, after: string): Edit {
  const row = rows[index];
  if (isListed(row) && before === "" && after === "") {
    const left = (row.depth ?? 0) > 0 ? { ...row, depth: (row.depth ?? 0) - 1 } : convert(row, "paragraph");
    return { rows: rows.map((r, i) => (i === index ? left : r)), focus: index, caret: 0 };
  }
  const next: Row = isListed(row)
    ? { id: newBlockId(), kind: row.kind, text: after, depth: row.depth, checked: row.kind === "task" ? false : undefined, list: row.list }
    : paragraphRow(after);
  if (row.links) next.links = row.links;
  const kept = { ...row, text: before };
  return { rows: [...rows.slice(0, index), kept, next, ...rows.slice(index + 1)], focus: index + 1, caret: 0 };
}

/** Backspace at the very start of a row: a styled row becomes a paragraph, an indented item moves out, a paragraph joins the text above. */
export function joinBackward(rows: Row[], index: number): Edit | null {
  const row = rows[index];
  if (isListed(row) && (row.depth ?? 0) > 0) return { rows: rows.map((r, i) => (i === index ? { ...row, depth: (row.depth ?? 0) - 1 } : r)), focus: index, caret: 0 };
  if (row.kind !== "paragraph") return { rows: rows.map((r, i) => (i === index ? convert(row, "paragraph") : r)), focus: index, caret: 0 };
  const above = index - 1;
  if (above < 0) return null;
  const previous = rows[above];
  if (previous.kind === "divider") return { rows: rows.filter((_, i) => i !== above), focus: above, caret: 0 };
  if (!isText(previous)) return null;
  const links = previous.links || row.links ? { ...row.links, ...previous.links } : undefined;
  const joined = { ...previous, text: previous.text + row.text, ...(links ? { links } : {}) };
  return { rows: [...rows.slice(0, above), joined, ...rows.slice(index + 1)], focus: above, caret: previous.text.length };
}

export function indent(rows: Row[], index: number, by: 1 | -1): Row[] {
  const row = rows[index];
  if (!isListed(row)) return rows;
  const previous = rows[index - 1];
  const max = previous && isListed(previous) ? (previous.depth ?? 0) + 1 : 0;
  const depth = Math.max(0, Math.min(max, (row.depth ?? 0) + by));
  return rows.map((r, i) => (i === index ? { ...row, depth } : r));
}

export function move(rows: Row[], from: number, to: number): Row[] {
  if (from === to) return rows;
  const next = rows.slice();
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

const TIDIED: RowKind[] = ["paragraph", "heading", "bullet", "ordered", "task", "quote", "callout"];

export interface Correction {
  original: string;
  replacement: string;
}

/**
 * A row's text once kertas has set its typography (spaces before French
 * punctuation, apostrophes, quotes, ellipses), corrected the misspellings its
 * dictionaries are sure of (but not the words in `manual`, which the writer
 * put back) and, when asked, marked what stands out in it, as the desktop
 * does to a paragraph it leaves. Only text without inline marks is touched;
 * null when nothing changes.
 */
export function tidyRow(engine: Kertas, row: Row, emphasize: boolean, manual: ReadonlySet<string> = new Set()): { text: string; corrected: Correction[] } | null {
  if (!TIDIED.includes(row.kind) || row.text.trim() === "") return null;
  const content = contentOf(engine, row.text);
  if (!content || content.length !== 1 || content[0].type !== "text" || content[0].marks?.length) return null;
  let text = content[0].text ?? "";
  for (const edit of [...engine.normalize(text)].reverse()) text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
  const corrected: Correction[] = [];
  if (engine.spelling) {
    for (const miss of [...engine.spell(text)].reverse()) {
      if (!miss.correction || manual.has(miss.word.toLowerCase())) continue;
      text = text.slice(0, miss.from) + miss.correction + text.slice(miss.to);
      corrected.unshift({ original: miss.word, replacement: miss.correction });
    }
  }
  const marks = emphasize && row.kind === "paragraph" ? engine.emphasize(text) : [];
  const pieces: DocNode[] = [];
  let at = 0;
  for (const mark of [...marks].sort((a, b) => a.from - b.from)) {
    if (mark.from < at) continue;
    if (mark.from > at) pieces.push({ type: "text", text: text.slice(at, mark.from) });
    pieces.push({ type: "text", text: text.slice(mark.from, mark.to), marks: [{ type: mark.mark }] });
    at = mark.to;
  }
  if (at < text.length) pieces.push({ type: "text", text: text.slice(at) });
  const tidied = engine.toMarkdown(paragraphDoc(pieces)).trim();
  return tidied === row.text ? null : { text: tidied, corrected };
}

const SECTION_NAMES = new Set(
  [
    "introduction", "conclusion", "conclusions", "problématique", "plan", "sommaire", "résumé", "contexte", "contexte et objectifs", "objectif", "objectifs",
    "enjeux", "méthode", "méthodologie", "résultats", "analyse", "discussion", "synthèse", "recommandations", "perspectives", "annexe", "annexes",
    "bibliographie", "références", "sources", "remerciements", "glossaire", "ordre du jour", "compte rendu", "compte-rendu", "participants", "présents",
    "absents", "décisions", "actions", "points abordés", "questions diverses", "prochaines étapes", "à faire", "budget", "calendrier", "planning",
    "risques", "livrables", "équipe", "notes", "idées", "questions",
    "summary", "abstract", "background", "context", "goals", "objectives", "method", "methods", "results", "findings", "recommendations", "appendix",
    "references", "agenda", "attendees", "decisions", "action items", "next steps", "timeline", "risks", "deliverables", "team", "ideas", "overview",
  ].map((name) => name.normalize("NFC")),
);
const TOP_SECTIONS = new Set(["introduction", "conclusion", "conclusions", "annexe", "annexes", "bibliographie", "références", "summary", "abstract", "appendix", "references"]);

const PRONOUN_OR_MARKER =
  /^(je|j['’]|tu|il|elle|on|nous|vous|ils|elles|bon|alors|donc|et|mais|si|ok|oui|non|merci|bref|enfin|puis|ensuite|i|you|he|she|we|they|so|and|but|if|thanks|yes|no)\b/i;
const SUBJECT_INSIDE = /\b(je|j['’]|tu|on|nous|vous|il|ils|elle|elles|i|we|you|they)\s+\p{L}/iu;

type Scheme = "roman" | "upper" | "arabic" | "lower";

interface Numbering {
  scheme: Scheme;
  depth: number;
  label: string;
}

function numberingOf(text: string): Numbering | null {
  const roman = /^(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})[.)–-]\s+(\S.*)$/u.exec(text);
  if (roman && roman[1] + roman[2] !== "") return { scheme: "roman", depth: 1, label: roman[3] };
  const upper = /^([A-H])[.)]\s+(\S.*)$/u.exec(text);
  if (upper) return { scheme: "upper", depth: 1, label: upper[2] };
  const arabic = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?[)]?\s+(\S.*)$/u.exec(text);
  if (arabic) return { scheme: "arabic", depth: arabic[1].split(".").length, label: arabic[2] };
  const lower = /^([a-h])\)\s+(\S.*)$/u.exec(text);
  if (lower) return { scheme: "lower", depth: 1, label: lower[2] };
  return null;
}

const SCHEME_ORDER: Scheme[] = ["roman", "upper", "arabic", "lower"];

function plainTextOf(engine: Kertas, row: Row): string {
  const content = contentOf(engine, row.text) ?? [];
  return content.map((node) => node.text ?? "").join("").trim();
}

const sectionName = (text: string) => text.replace(/\s*:$/, "").trim().toLowerCase().normalize("NFC");
const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean);

/** How a heading looks, so that a line shaped like an earlier heading is read as its sibling. */
function shapeOf(text: string): string {
  const numbering = numberingOf(text);
  if (numbering) return `${numbering.scheme}:${numbering.depth}`;
  if (SECTION_NAMES.has(sectionName(text))) return "section";
  return "plain";
}

export interface HeadingGuess {
  level: number;
  sure: boolean;
  /** The heading's text: the line's own, or a lone numbered item's with its number. */
  text: string;
}

/**
 * Whether the paragraph at `index` reads as a heading over the text that
 * follows it, and at which level, from the rules of written documents:
 * numbered parts (I. / A. / 1. / a), or 1. / 1.1 / 1.1.1), the section names
 * that recur in essays, reports and minutes, the shape of the headings the
 * document already has, and the outline above it, never skipping a level.
 * `sure` when the line follows one of those rules, so it can be applied
 * without asking; otherwise only likely.
 */
export function headingFor(engine: Kertas, rows: Row[], index: number, maxLevel = 3): HeadingGuess | null {
  const row = rows[index];
  const next = rows[index + 1];
  if (!row || !next || !isText(next) || next.kind === "heading" || isListed(next)) return null;
  const lone = row.kind === "ordered" && (row.depth ?? 0) === 0 && !isListed(rows[index - 1] ?? paragraphRow());
  if (row.kind !== "paragraph" && !lone) return null;
  const own = plainTextOf(engine, row);
  const text = lone ? `${Number(row.list?.start ?? 1)}. ${own}` : own;
  const following = plainTextOf(engine, next);
  if (!text || !following) return null;
  const words = wordsOf(text);
  if (words.length > 9 || /[.,;!…]$/.test(text) || text.includes("\n")) return null;

  const headings = rows.slice(0, index).flatMap((r) => (r.kind === "heading" ? [{ level: r.level ?? 1, text: plainTextOf(engine, r) }] : []));
  const numbering = numberingOf(text);
  const named = SECTION_NAMES.has(sectionName(text));
  const shape = shapeOf(text);
  const sibling = [...headings].reverse().find((heading) => shapeOf(heading.text) === shape && shape !== "plain");
  const label = numbering?.label ?? text;
  const conversational = PRONOUN_OR_MARKER.test(label) || SUBJECT_INSIDE.test(label);
  const question = /\?$/.test(text);

  const listed = numbering && numberingOf(following)?.scheme === numbering.scheme;
  if (listed) return null;
  let sure = false;
  if (numbering && wordsOf(numbering.label).length <= 8 && !conversational) sure = true;
  else if (named && !question) sure = true;
  else if (sibling && !conversational) sure = true;
  if (!sure) {
    if (conversational || question || words.length > 7 || !/^\p{Lu}/u.test(text)) return null;
    if (following.length < text.length) return null;
    const block = engine.classify(text, following);
    if (block.kind !== "heading") return null;
  }

  const top = headings.length ? Math.min(...headings.map((h) => h.level)) : 1;
  const previous = headings[headings.length - 1];
  let level: number;
  if (numbering) {
    const schemes = [...new Set(headings.flatMap((h) => numberingOf(h.text)?.scheme ?? []).concat(numbering.scheme))].sort(
      (a, b) => SCHEME_ORDER.indexOf(a) - SCHEME_ORDER.indexOf(b),
    );
    const rank = numbering.scheme === "arabic" && !schemes.some((s) => s === "roman" || s === "upper") ? numbering.depth : schemes.indexOf(numbering.scheme) + 1;
    level = top + rank - 1;
  } else if (sibling) {
    level = sibling.level;
  } else if (named && TOP_SECTIONS.has(sectionName(text))) {
    level = top;
  } else if (!previous) {
    level = 1;
  } else {
    let above = index - 1;
    while (above >= 0 && rows[above].kind !== "heading") above--;
    const since = rows.slice(above + 1, index);
    const filled = since.some((r) => r.kind !== "paragraph" || plainTextOf(engine, r).length > 80) || since.length > 1;
    level = filled ? previous.level : previous.level + 1;
  }
  const deepest = previous ? previous.level + 1 : 1;
  return { level: Math.max(1, Math.min(level, deepest, maxLevel)), sure, text: lone ? text : row.text };
}

