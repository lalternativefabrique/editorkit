// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { formattingExtensions } from "./formatting";
import {
  addComment,
  replyToComment,
  resolveComment,
  reviewExtensions,
  settleSuggestion,
  suggestionsOf,
  threadsOf,
  type SuggestingStorage,
} from "./review";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(html: string): Editor {
  editor = new Editor({
    extensions: [StarterKit.configure({ codeBlock: false, document: false }), ...formattingExtensions, ...reviewExtensions("Léa")],
    content: html,
  });
  return editor;
}

function type(e: Editor, text: string) {
  for (const char of text) {
    const { from, to } = e.state.selection;
    const handled = e.view.someProp("handleTextInput", (f) => f(e.view, from, to, char, () => e.state.tr.insertText(char, from, to)));
    if (!handled) e.view.dispatch(e.state.tr.insertText(char, from, to));
  }
}

function press(e: Editor, key: string) {
  e.view.someProp("handleKeyDown", (f) => f(e.view, new KeyboardEvent("keydown", { key })));
}

const suggesting = (e: Editor) => e.storage.kertasSuggesting as SuggestingStorage;

describe("comments", () => {
  it("keeps a thread on the passage, answers it and closes it", () => {
    const e = open("<p>Le devis est prêt.</p>");
    e.commands.setTextSelection({ from: 4, to: 9 });
    expect(addComment(e, "Quel montant ?", "Léa")).toBe(true);
    const [thread] = threadsOf(e.state.doc);
    expect(thread.quote).toBe("devis");
    replyToComment(e, thread.id, "1 900 €", "Marc");
    expect(threadsOf(e.state.doc)[0].messages.map((m) => `${m.author}: ${m.text}`)).toEqual(["Léa: Quel montant ?", "Marc: 1 900 €"]);
    resolveComment(e, thread.id);
    expect(threadsOf(e.state.doc)).toEqual([]);
    expect(JSON.stringify(e.getJSON())).not.toContain('"comment"');
  });

  it("needs a selection", () => {
    const e = open("<p>Rien</p>");
    expect(addComment(e, "?", "Léa")).toBe(false);
  });
});

describe("suggestions", () => {
  it("records typing as one insertion and deleting as a deletion, then accepts them", () => {
    const e = open("<p>Le devis est prêt.</p>");
    suggesting(e).on = true;
    e.commands.setTextSelection(14);
    type(e, "bientôt ");
    e.commands.setTextSelection(4);
    for (let i = 0; i < 6; i += 1) press(e, "Delete");
    expect(e.state.doc.textContent).toBe("Le devis est bientôt prêt.");
    expect(suggestionsOf(e.state.doc).map((s) => [s.kind, s.text, s.author])).toEqual([
      ["deletion", "devis ", "Léa"],
      ["insertion", "bientôt ", "Léa"],
    ]);
    settleSuggestion(e, null, true);
    expect(e.state.doc.textContent).toBe("Le est bientôt prêt.");
    expect(suggestionsOf(e.state.doc)).toEqual([]);
  });

  it("refuses a suggestion by putting the text back as it was", () => {
    const e = open("<p>Le devis est prêt.</p>");
    suggesting(e).on = true;
    e.commands.setTextSelection({ from: 14, to: 19 });
    type(e, "fini");
    const [deleted, inserted] = suggestionsOf(e.state.doc);
    settleSuggestion(e, inserted.id, false);
    settleSuggestion(e, deleted.id, false);
    expect(e.state.doc.textContent).toBe("Le devis est prêt.");
  });

  it("removes outright what was only proposed, and edits normally when off", () => {
    const e = open("<p>Texte</p>");
    suggesting(e).on = true;
    e.commands.setTextSelection(6);
    type(e, "!!");
    press(e, "Backspace");
    expect(e.state.doc.textContent).toBe("Texte!");
    suggesting(e).on = false;
    type(e, "?");
    expect(suggestionsOf(e.state.doc).map((s) => s.text)).toEqual(["!"]);
  });
});
