import { Extension, mergeAttributes, Node } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";
import type { SlashItem } from "../index";

import type { Kertas } from "./engine";
import type { Lang } from "./types";

export interface Person {
  id: string;
  name: string;
}

export interface DateRefAttrs {
  date: string;
  label: string;
}

export interface PersonRefAttrs {
  person: string;
  name: string;
}

function inlineAtom(name: string, tag: string, attrs: Record<string, string>, text: (attrs: Record<string, string>) => string) {
  return Node.create({
    name,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,

    addAttributes() {
      return Object.fromEntries(
        Object.entries(attrs).map(([key, data]) => [
          key,
          {
            default: "",
            parseHTML: (element: HTMLElement) => element.getAttribute(data) ?? "",
            renderHTML: (attributes: Record<string, string>) => ({ [data]: attributes[key] }),
          },
        ]),
      );
    },

    parseHTML() {
      return [{ tag: `span[${tag}]` }];
    },

    renderHTML({ node, HTMLAttributes }) {
      return ["span", mergeAttributes(HTMLAttributes, { [tag]: "", class: `kertas-${name}` }), text(node.attrs)];
    },

    renderText({ node }) {
      return text(node.attrs);
    },
  });
}

/** A day named in the text, kept as its ISO date with the words shown for it. */
export const DateRef = inlineAtom("dateRef", "data-date-ref", { date: "data-date", label: "data-label" }, (attrs) => attrs.label || attrs.date);

/** A person named in the text, kept by id. */
export const PersonRef = inlineAtom("personRef", "data-person-ref", { person: "data-person", name: "data-name" }, (attrs) => `@${attrs.name}`);

export const mentionExtensions = [DateRef, PersonRef];

const SUGGESTED_DAYS: Record<Lang, string[]> = {
  fr: ["aujourd'hui", "demain", "lundi prochain"],
  en: ["today", "tomorrow", "next monday"],
};

export function dayLabel(iso: string, lang: Lang, today = new Date()): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" };
  if (year !== today.getFullYear()) options.year = "numeric";
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "fr-FR", options).format(date);
}

function insert(editor: Editor, range: { from: number; to: number }, node: { type: string; attrs: Record<string, string> }) {
  editor.chain().focus().deleteRange(range).insertContent([node, { type: "text", text: " " }]).run();
}

/** Days for `@`: the one the typed words name ("demain", "vendredi", "12/03"), or a few to start from. */
export function dateItems(engine: Kertas): (query: string) => SlashItem[] {
  return (query = "") => {
    const words = query.trim() ? [query.trim()] : SUGGESTED_DAYS[engine.language];
    const seen = new Set<string>();
    return words.flatMap((words): SlashItem[] => {
      const moment = engine.understand(words);
      if (!moment.day_found || seen.has(moment.day)) return [];
      seen.add(moment.day);
      const label = dayLabel(moment.day, engine.language);
      return [
        {
          id: `date-${moment.day}`,
          title: `${query.trim() ? query.trim() : words} · ${label}`,
          description: moment.day,
          command: ({ editor, range }) => insert(editor, range, { type: "dateRef", attrs: { date: moment.day, label } }),
        },
      ];
    });
  };
}

/** People for `@`, from the host's list. */
export function personItems(people: () => Person[]): () => SlashItem[] {
  return () =>
    people().map((person) => ({
      id: `person-${person.id}`,
      title: person.name,
      description: "personne",
      command: ({ editor, range }) => insert(editor, range, { type: "personRef", attrs: { person: person.id, name: person.name } }),
    }));
}

const EMOJI: [string, string][] = [
  ["👍", "pouce oui ok thumbs up"],
  ["👎", "pouce non thumbs down"],
  ["🙂", "sourire smile"],
  ["😀", "rire grin"],
  ["😂", "mort de rire joy"],
  ["😉", "clin d'oeil wink"],
  ["😍", "amoureux love"],
  ["😢", "triste pleure cry sad"],
  ["😮", "surpris wow"],
  ["🤔", "réfléchir think"],
  ["🙏", "merci prier thanks pray"],
  ["👏", "bravo applaudir clap"],
  ["💪", "force muscle strong"],
  ["🎉", "fête bravo party tada"],
  ["❤️", "coeur amour heart"],
  ["🔥", "feu fire"],
  ["⭐", "étoile star"],
  ["✅", "fait valide coche done check"],
  ["❌", "non erreur croix no cross"],
  ["⚠️", "attention avertissement warning"],
  ["❓", "question"],
  ["💡", "idée idea"],
  ["📌", "épingle important pin"],
  ["📅", "date calendrier calendar"],
  ["⏰", "réveil alarme rappel alarm"],
  ["📞", "téléphone appel phone call"],
  ["✉️", "mail lettre email"],
  ["💬", "message commentaire chat"],
  ["📎", "trombone pièce jointe attachment"],
  ["📈", "hausse croissance up chart"],
  ["📉", "baisse down chart"],
  ["💰", "argent money"],
  ["💶", "euro billet"],
  ["🚀", "fusée lancement rocket launch"],
  ["🐛", "bug bogue"],
  ["🛠️", "outils réparer tools"],
  ["☕", "café coffee"],
  ["🍕", "pizza"],
  ["🏠", "maison home"],
  ["✈️", "avion voyage plane travel"],
];

/** Emoji for `:` followed by a word in French or English ("coeur", "fête", "rocket"). */
export function emojiItems(query = ""): SlashItem[] {
  if (!query.trim()) return [];
  return EMOJI.map(([emoji, words]) => ({
    id: `emoji-${emoji}`,
    title: `${emoji} ${words.split(" ")[0]}`,
    description: words,
    command: ({ editor, range }: Parameters<SlashItem["command"]>[0]) => editor.chain().focus().deleteRange(range).insertContent(emoji).run(),
  }));
}

interface Recognized {
  from: number;
  to: number;
  node: { type: "dateRef" | "personRef"; attrs: Record<string, string> };
  hint: string;
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const isLetter = (char: string | undefined) => !!char && /[\p{L}\p{N}]/u.test(char);

function peopleIn(text: string, start: number, people: Person[]): Recognized[] {
  const folded = fold(text);
  const found: Recognized[] = [];
  const firstNames = new Map<string, Person[]>();
  for (const person of people) {
    const first = fold(person.name.split(" ")[0] ?? "");
    firstNames.set(first, [...(firstNames.get(first) ?? []), person]);
  }
  for (const person of people) {
    const names = [fold(person.name)];
    const first = fold(person.name.split(" ")[0] ?? "");
    if (first !== names[0] && firstNames.get(first)?.length === 1) names.push(first);
    for (const name of names) {
      let at = folded.indexOf(name);
      while (at >= 0) {
        const end = at + name.length;
        if (!isLetter(folded[at - 1]) && !isLetter(folded[end]) && !found.some((f) => f.from < start + end && start + at < f.to)) {
          found.push({ from: start + at, to: start + end, node: { type: "personRef", attrs: { person: person.id, name: person.name } }, hint: `@${person.name}` });
        }
        at = folded.indexOf(name, end);
      }
    }
  }
  return found;
}

function recognize(state: EditorState, engine: Kertas, people: Person[]): Recognized[] {
  const { $head } = state.selection;
  const block = $head.parent;
  if (!block.isTextblock || block.type.spec.code) return [];
  const start = $head.start();
  const text = block.textBetween(0, block.content.size, undefined, "￼");
  if (!text.trim()) return [];
  const days: Recognized[] = engine.recognizeDays(text).map((found) => {
    const label = dayLabel(found.day, engine.language);
    return { from: start + found.from, to: start + found.to, node: { type: "dateRef", attrs: { date: found.day, label } }, hint: label };
  });
  const named = peopleIn(text, start, people).filter((person) => !days.some((day) => day.from < person.to && person.from < day.to));
  const linked: { from: number; to: number }[] = [];
  block.forEach((child, offset) => {
    if (child.marks.some((mark) => mark.type.name === "link")) linked.push({ from: start + offset, to: start + offset + child.nodeSize });
  });
  return [...days, ...named].filter((found) => !linked.some((link) => link.from < found.to && found.from < link.to)).sort((a, b) => a.from - b.from);
}

const recognizeKey = new PluginKey<Recognized[]>("kertasRecognize");

function accept(view: EditorView, found: Recognized): boolean {
  const type = view.state.schema.nodes[found.node.type];
  if (!type) return false;
  view.dispatch(view.state.tr.replaceWith(found.from, found.to, type.create(found.node.attrs)));
  return true;
}

export interface RecognizeOptions {
  engine: Kertas | null;
  people: () => Person[];
}

/**
 * Underlines, in the paragraph being written, the days kertas reads and the
 * people the host knows; Tab right after one, or a click on it, makes it a
 * mention, and Tab keeps its usual role anywhere else.
 */
export const Recognize = Extension.create<RecognizeOptions>({
  name: "kertasRecognize",

  addOptions() {
    return { engine: null, people: () => [] };
  },

  addProseMirrorPlugins() {
    const { engine, people } = this.options;
    if (!engine) return [];
    return [
      new Plugin<Recognized[]>({
        key: recognizeKey,
        state: {
          init: (_, state) => recognize(state, engine, people()),
          apply: (tr, previous, _old, state) => (tr.docChanged || tr.selectionSet ? recognize(state, engine, people()) : previous),
        },
        props: {
          decorations(state) {
            const found = recognizeKey.getState(state) ?? [];
            return DecorationSet.create(
              state.doc,
              found.map((f) => Decoration.inline(f.from, f.to, { class: "kertas-recognized", title: `Tab : ${f.hint}` })),
            );
          },
          handleKeyDown(view, event) {
            if (event.key !== "Tab" || event.shiftKey) return false;
            const head = view.state.selection.head;
            const found = (recognizeKey.getState(view.state) ?? []).filter((f) => f.from <= head && head <= f.to + 1).pop();
            return found ? accept(view, found) : false;
          },
          handleClick(view, pos) {
            const found = (recognizeKey.getState(view.state) ?? []).find((f) => f.from <= pos && pos < f.to);
            return found ? accept(view, found) : false;
          },
        },
      }),
    ];
  },
});
