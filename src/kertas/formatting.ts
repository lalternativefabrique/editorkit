import { Extension, mergeAttributes, Node } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import { common, createLowlight } from "lowlight";

import { PrintableDocument } from "./print";
import { Highlight } from "@tiptap/extension-highlight";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";
import type { SlashItem } from "../index";

export const TONES = ["note", "tip", "important", "warning", "caution"] as const;
export type Tone = (typeof TONES)[number];

export const TONE_LABELS: Record<Tone, string> = {
  note: "Note",
  tip: "Astuce",
  important: "Important",
  warning: "Attention",
  caution: "Danger",
};

const TONE_GLYPHS: Record<Tone, string> = {
  note: "ℹ",
  tip: "✦",
  important: "!",
  warning: "⚠",
  caution: "⛔",
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (tone?: Tone) => ReturnType;
    };
    toggle: {
      setToggle: () => ReturnType;
    };
  }
}

const nextTone = (tone: Tone): Tone => TONES[(TONES.indexOf(tone) + 1) % TONES.length];

function blockView(
  node: PMNode,
  kind: "callout" | "toggle",
  control: (node: PMNode) => { label: string; glyph: string; state: Record<string, string> },
  onControl: (node: PMNode) => Record<string, unknown>,
  setAttrs: (attrs: Record<string, unknown>) => void,
): NodeView {
  const dom = document.createElement("div");
  dom.className = `kertas-${kind}`;
  const button = document.createElement("button");
  button.type = "button";
  button.contentEditable = "false";
  button.className = `kertas-${kind}-control`;
  const contentDOM = document.createElement("div");
  contentDOM.className = `kertas-${kind}-body`;
  dom.append(button, contentDOM);

  let current = node;
  const paint = () => {
    const { label, glyph, state } = control(current);
    button.textContent = glyph;
    button.title = label;
    button.setAttribute("aria-label", label);
    for (const [key, value] of Object.entries(state)) dom.dataset[key] = value;
  };
  paint();
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => setAttrs(onControl(current)));

  return {
    dom,
    contentDOM,
    update(next) {
      if (next.type !== current.type) return false;
      current = next;
      paint();
      return true;
    },
    ignoreMutation: (mutation) => mutation.target === button || button.contains(mutation.target as globalThis.Node),
  };
}

/** A block set apart with a tone, written in Markdown as a GitHub alert (`> [!NOTE]`). */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: "note",
        parseHTML: (element) => element.getAttribute("data-tone") ?? "note",
        renderHTML: (attributes) => ({ "data-tone": attributes.tone }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-callout": "" }), 0];
  },

  addCommands() {
    return {
      setCallout:
        (tone = "note") =>
        ({ commands }) =>
          commands.wrapIn(this.name, { tone }),
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) =>
      blockView(
        node,
        "callout",
        (current) => {
          const tone = current.attrs.tone as Tone;
          return { label: `${TONE_LABELS[tone]} — changer`, glyph: TONE_GLYPHS[tone], state: { tone } };
        },
        (current) => ({ tone: nextTone(current.attrs.tone as Tone) }),
        (attrs) => {
          const pos = getPos();
          if (typeof pos !== "number") return;
          const at = editor.state.doc.nodeAt(pos);
          if (at) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...at.attrs, ...attrs }));
        },
      );
  },
});

/** A block whose first paragraph is its title and the rest folds away, written as `<details>`. */
export const Toggle = Node.create({
  name: "toggle",
  group: "block",
  content: "paragraph block*",
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element) => element.getAttribute("data-open") !== "false",
        renderHTML: (attributes) => ({ "data-open": String(attributes.open) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-toggle]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toggle": "" }), 0];
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ commands }) =>
          commands.wrapIn(this.name, { open: true }),
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) =>
      blockView(
        node,
        "toggle",
        (current) => {
          const open = current.attrs.open === true;
          return { label: open ? "Replier" : "Déplier", glyph: open ? "▾" : "▸", state: { open: String(open) } };
        },
        (current) => ({ open: current.attrs.open !== true }),
        (attrs) => {
          const pos = getPos();
          if (typeof pos !== "number") return;
          const at = editor.state.doc.nodeAt(pos);
          if (at) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...at.attrs, ...attrs }));
        },
      );
  },
});

const MATH_NODES = ["inlineMath", "blockMath"];

export interface MathEditingOptions {
  /** Asks for a formula's LaTeX, null to leave it as it is. */
  ask: (latex: string) => string | null;
}

const askLatex = (latex: string) => window.prompt("Formule (LaTeX)", latex);

/** Edits a formula when it is clicked. */
export const MathEditing = Extension.create<MathEditingOptions>({
  name: "kertasMathEditing",

  addOptions() {
    return { ask: askLatex };
  },

  addProseMirrorPlugins() {
    const { ask } = this.options;
    return [
      new Plugin({
        key: new PluginKey("kertasMathEditing"),
        props: {
          handleClickOn(view, _pos, node, nodePos) {
            if (!MATH_NODES.includes(node.type.name)) return false;
            const latex = ask(node.attrs.latex as string);
            if (latex === null || !latex.trim()) return true;
            view.dispatch(view.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, latex: latex.trim() }));
            return true;
          },
        },
      }),
    ];
  },
});

/** Code blocks coloured by language, guessed when none is given. */
export const CodeBlock = CodeBlockLowlight.configure({ lowlight: createLowlight(common), defaultLanguage: null });

/**
 * Task lists, highlight, text colour, callouts, toggles, formulas, coloured code and a printable
 * document, as one set for any kertas editor; hosts turn off StarterKit's document and code block.
 */
export const formattingExtensions = [
  PrintableDocument,
  TaskList,
  TaskItem.configure({ nested: true }),
  Highlight.configure({ multicolor: true }),
  TextStyle,
  Color,
  Callout,
  Toggle,
  InlineMath.configure({ katexOptions: { throwOnError: false } }),
  BlockMath.configure({ katexOptions: { displayMode: true, throwOnError: false } }),
  MathEditing,
  CodeBlock,
];

export interface FormattingSlashLabels {
  formula: string;
  formulaDescription: string;
  inlineFormula: string;
  inlineFormulaDescription: string;
  tasks: string;
  tasksDescription: string;
  callout: string;
  calloutDescription: string;
  toggle: string;
  toggleDescription: string;
}

export const defaultFormattingSlashLabels: FormattingSlashLabels = {
  formula: "Formule",
  formulaDescription: "une équation sur sa ligne, en LaTeX",
  inlineFormula: "Formule dans le texte",
  inlineFormulaDescription: "une expression en LaTeX dans la phrase",
  tasks: "Liste de tâches",
  tasksDescription: "des cases à cocher",
  callout: "Encadré",
  calloutDescription: "une note, une astuce, un avertissement",
  toggle: "Bloc repliable",
  toggleDescription: "un titre qui cache la suite",
};

export function formattingSlashItems(
  labels: FormattingSlashLabels = defaultFormattingSlashLabels,
  ask: (latex: string) => string | null = askLatex,
): SlashItem[] {
  const formula = (kind: "block" | "inline") => ({ editor, range }: Parameters<SlashItem["command"]>[0]) => {
    const latex = ask("")?.trim();
    editor.chain().focus().deleteRange(range).run();
    if (!latex) return;
    if (kind === "block") editor.commands.insertBlockMath({ latex });
    else editor.commands.insertInlineMath({ latex });
  };
  return [
    { id: "formula", title: labels.formula, description: labels.formulaDescription, command: formula("block") },
    {
      id: "inline-formula",
      title: labels.inlineFormula,
      description: labels.inlineFormulaDescription,
      command: formula("inline"),
    },
    {
      id: "tasks",
      title: labels.tasks,
      description: labels.tasksDescription,
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
    },
    {
      id: "callout",
      title: labels.callout,
      description: labels.calloutDescription,
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCallout().run(),
    },
    {
      id: "toggle",
      title: labels.toggle,
      description: labels.toggleDescription,
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setToggle().run(),
    },
  ];
}
