// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { BlockIds } from "./blockIds";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(content: string | object): Editor {
  let next = 0;
  editor = new Editor({
    extensions: [StarterKit, BlockIds.configure({ newId: () => `b${++next}` })],
    content,
  });
  return editor;
}

function ids(e: Editor): (string | null)[] {
  const out: (string | null)[] = [];
  e.state.doc.descendants((node) => {
    if (node.isBlock) out.push(node.attrs.id ?? null);
    return true;
  });
  return out;
}

const unique = (values: (string | null)[]) => values.every((v) => v) && new Set(values).size === values.length;

describe("every block has a stable id", () => {
  it("gives ids to a document as soon as it opens", () => {
    const e = open("<h2>Titre</h2><p>un</p><ul><li><p>deux</p></li></ul>");
    expect(unique(ids(e))).toBe(true);
    expect(ids(e).length).toBeGreaterThanOrEqual(5);
  });

  it("gives them without reporting an edit, so opening a note does not save it", () => {
    let updates = 0;
    editor = new Editor({
      extensions: [StarterKit, BlockIds],
      content: "<p>un</p>",
      onUpdate: () => updates++,
    });
    expect(unique(ids(editor))).toBe(true);
    expect(updates).toBe(0);
  });

  it("keeps the ids of a document saved with them", () => {
    const saved = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "keep-1" }, content: [{ type: "text", text: "un" }] },
        { type: "paragraph", attrs: { id: "keep-2" }, content: [{ type: "text", text: "deux" }] },
      ],
    };
    expect(ids(open(saved))).toEqual(["keep-1", "keep-2"]);
  });

  it("keeps an id while typing and gives the new half of a split its own", () => {
    const e = open({ type: "doc", content: [{ type: "paragraph", attrs: { id: "p" }, content: [{ type: "text", text: "avant après" }] }] });
    e.commands.setTextSelection(7);
    e.commands.insertContent("x");
    expect(ids(e)).toEqual(["p"]);
    e.commands.splitBlock();
    const after = ids(e);
    expect(after[0]).toBe("p");
    expect(unique(after)).toBe(true);
  });

  it("renews the id of a pasted copy", () => {
    const e = open({ type: "doc", content: [{ type: "paragraph", attrs: { id: "p" }, content: [{ type: "text", text: "copie" }] }] });
    e.commands.insertContentAt(e.state.doc.content.size, { type: "paragraph", attrs: { id: "p" }, content: [{ type: "text", text: "copie" }] });
    const after = ids(e);
    expect(after[0]).toBe("p");
    expect(unique(after)).toBe(true);
  });

  it("writes the ids into the saved JSON", () => {
    const e = open("<p>un</p>");
    expect(e.getJSON().content?.[0]?.attrs?.id).toBe("b1");
  });
});
