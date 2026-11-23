import { Extension, Mark, mergeAttributes, type Editor } from "@tiptap/core";
import type { Node as PMNode, Mark as PMMark } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export interface CommentMessage {
  author: string;
  text: string;
  at: string;
}

export interface CommentThread {
  id: string;
  quote: string;
  messages: CommentMessage[];
}

export type SuggestionKind = "insertion" | "deletion";

export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  author: string;
  text: string;
}

const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function idMark(name: string, tag: string, className: string, extra: Record<string, string> = {}) {
  return Mark.create({
    name,
    inclusive: false,
    excludes: "",

    addAttributes() {
      return Object.fromEntries(
        ["id", ...Object.keys(extra)].map((key) => [
          key,
          {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute(`data-${key}`),
            renderHTML: (attributes: Record<string, string | null>) => (attributes[key] ? { [`data-${key}`]: attributes[key] } : {}),
          },
        ]),
      );
    },

    parseHTML() {
      return [{ tag: `${tag}[data-${name}]` }];
    },

    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes, { [`data-${name}`]: "", class: className }), 0];
    },
  });
}

export const CommentMark = idMark("comment", "span", "kertas-comment");
export const Insertion = idMark("insertion", "ins", "kertas-insertion", { author: "" });
export const Deletion = idMark("deletion", "del", "kertas-deletion", { author: "" });

export function threadsOf(doc: PMNode): CommentThread[] {
  const stored = (doc.attrs.comments as Record<string, Omit<CommentThread, "id">> | null) ?? {};
  const order: string[] = [];
  doc.descendants((node) => {
    for (const mark of node.marks) {
      const id = mark.type.name === "comment" ? (mark.attrs.id as string) : null;
      if (id && stored[id] && !order.includes(id)) order.push(id);
    }
  });
  return order.map((id) => ({ id, ...stored[id] }));
}

function setThreads(tr: Transaction, doc: PMNode, change: (threads: Record<string, Omit<CommentThread, "id">>) => void) {
  const threads = { ...((doc.attrs.comments as Record<string, Omit<CommentThread, "id">> | null) ?? {}) };
  change(threads);
  return tr.setDocAttribute("comments", Object.keys(threads).length ? threads : null);
}

/** Comments the selected passage; false when nothing is selected. */
export function addComment(editor: Editor, text: string, author: string): boolean {
  const { state } = editor;
  const { from, to, empty } = state.selection;
  if (empty || !text.trim()) return false;
  const id = newId();
  const quote = state.doc.textBetween(from, to, " ");
  const tr = state.tr.addMark(from, to, state.schema.marks.comment.create({ id }));
  setThreads(tr, state.doc, (threads) => {
    threads[id] = { quote, messages: [{ author, text: text.trim(), at: now() }] };
  });
  editor.view.dispatch(tr);
  return true;
}

export function replyToComment(editor: Editor, id: string, text: string, author: string): void {
  if (!text.trim()) return;
  const { state } = editor;
  editor.view.dispatch(
    setThreads(state.tr, state.doc, (threads) => {
      const thread = threads[id];
      if (thread) threads[id] = { ...thread, messages: [...thread.messages, { author, text: text.trim(), at: now() }] };
    }),
  );
}

function rangesOf(doc: PMNode, name: string, id: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === name && mark.attrs.id === id)) {
      ranges.push({ from: pos, to: pos + node.nodeSize });
    }
  });
  return ranges;
}

/** Closes a thread: its passage loses the highlight and the thread leaves the document. */
export function resolveComment(editor: Editor, id: string): void {
  const { state } = editor;
  const tr = state.tr;
  const mark = state.schema.marks.comment.create({ id });
  for (const range of rangesOf(state.doc, "comment", id)) tr.removeMark(range.from, range.to, mark);
  setThreads(tr, state.doc, (threads) => {
    delete threads[id];
  });
  editor.view.dispatch(tr);
}

export function suggestionsOf(doc: PMNode): Suggestion[] {
  const found = new Map<string, Suggestion>();
  doc.descendants((node) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type.name !== "insertion" && mark.type.name !== "deletion") continue;
      const id = mark.attrs.id as string;
      const current = found.get(id);
      if (current) current.text += node.text ?? "";
      else found.set(id, { id, kind: mark.type.name, author: (mark.attrs.author as string) ?? "", text: node.text ?? "" });
    }
  });
  return [...found.values()];
}

/** Applies (accept) or drops (reject) one suggestion, or all when id is null. */
export function settleSuggestion(editor: Editor, id: string | null, accept: boolean): void {
  const { state } = editor;
  const tr = state.tr;
  const targets: { from: number; to: number; mark: PMMark }[] = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if ((mark.type.name === "insertion" || mark.type.name === "deletion") && (id === null || mark.attrs.id === id)) {
        targets.push({ from: pos, to: pos + node.nodeSize, mark });
      }
    }
  });
  for (const { from, to, mark } of targets.reverse()) {
    const keep = (mark.type.name === "insertion") === accept;
    const start = tr.mapping.map(from);
    const end = tr.mapping.map(to);
    if (keep) tr.removeMark(start, end, mark);
    else tr.delete(start, end);
  }
  editor.view.dispatch(tr);
}

export interface SuggestingOptions {
  author: string;
}

export interface SuggestingStorage {
  on: boolean;
}

declare module "@tiptap/core" {
  interface Storage {
    kertasSuggesting: SuggestingStorage;
  }
}

const suggestingKey = new PluginKey("kertasSuggesting");

function neighbourId(state: EditorState, pos: number, name: SuggestionKind, author: string): string | null {
  const $pos = state.doc.resolve(pos);
  for (const node of [$pos.nodeBefore, $pos.nodeAfter]) {
    const mark = node?.marks.find((m) => m.type.name === name && m.attrs.author === author);
    if (mark) return mark.attrs.id as string;
  }
  return null;
}

/** Marks for a suggestion at pos, continuing the one beside it by the same author. */
function suggestionMarks(state: EditorState, author: string, pos = state.selection.from) {
  return {
    insertion: state.schema.marks.insertion.create({ id: neighbourId(state, pos, "insertion", author) ?? newId(), author }),
    deletion: state.schema.marks.deletion.create({ id: neighbourId(state, pos, "deletion", author) ?? newId(), author }),
  };
}

const ownInsertion = (node: PMNode | null | undefined) => node?.marks.some((mark) => mark.type.name === "insertion");

/** Turns a deletion into a proposal: text already proposed goes, other text is struck through. */
function proposeDeletion(view: EditorView, from: number, to: number, author: string, cursor: number): boolean {
  const { state } = view;
  const tr = state.tr;
  const { deletion } = suggestionMarks(state, author, from);
  const spans: { from: number; to: number; inserted: boolean }[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    spans.push({ from: Math.max(from, pos), to: Math.min(to, pos + node.nodeSize), inserted: !!ownInsertion(node) });
  });
  for (const span of spans.reverse()) {
    if (span.inserted) tr.delete(span.from, span.to);
    else tr.addMark(span.from, span.to, deletion);
  }
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(cursor)));
  view.dispatch(tr);
  return true;
}

/** Records typing and deleting as suggestions while on. Splitting blocks is applied as is. */
export const Suggesting = Extension.create<SuggestingOptions, SuggestingStorage>({
  name: "kertasSuggesting",

  addOptions() {
    return { author: "" };
  },

  addStorage() {
    return { on: false };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    const author = () => this.options.author;
    return [
      new Plugin({
        key: suggestingKey,
        view: (view) => {
          const paint = () => view.dom.classList.toggle("kertas-suggesting", storage.on);
          paint();
          return { update: paint };
        },
        props: {
          handleTextInput(view, from, to, text) {
            if (!storage.on) return false;
            const { state } = view;
            const { insertion, deletion } = suggestionMarks(state, author(), to);
            const tr = state.tr;
            if (from < to) tr.addMark(from, to, deletion);
            tr.insert(to, state.schema.text(text, [insertion]));
            tr.setSelection(TextSelection.create(tr.doc, to + text.length));
            view.dispatch(tr);
            return true;
          },
          handleKeyDown(view, event) {
            if (!storage.on || (event.key !== "Backspace" && event.key !== "Delete")) return false;
            const { selection } = view.state;
            if (!selection.empty) return proposeDeletion(view, selection.from, selection.to, author(), selection.from);
            const { $from } = selection;
            if (event.key === "Backspace") {
              if ($from.parentOffset === 0) return false;
              return proposeDeletion(view, $from.pos - 1, $from.pos, author(), $from.pos - 1);
            }
            if ($from.parentOffset === $from.parent.content.size) return false;
            return proposeDeletion(view, $from.pos, $from.pos + 1, author(), $from.pos + 1);
          },
          handlePaste(view, event) {
            if (!storage.on) return false;
            const text = event.clipboardData?.getData("text/plain");
            if (!text) return false;
            const { state } = view;
            const { from, to } = state.selection;
            const { insertion, deletion } = suggestionMarks(state, author());
            const tr = state.tr;
            if (from < to) tr.addMark(from, to, deletion);
            tr.insert(to, state.schema.text(text.replace(/\n+/g, " "), [insertion]));
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});

/** Comments and suggestions, signed with the name of who writes. */
export function reviewExtensions(author: string) {
  return [CommentMark, Insertion, Deletion, Suggesting.configure({ author })];
}
