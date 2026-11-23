// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { formattingExtensions } from "./formatting";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function open(content: string): Editor {
  editor = new Editor({ extensions: [StarterKit.configure({ codeBlock: false, document: false }), ...formattingExtensions], content });
  return editor;
}

const marksOf = (e: Editor) => e.getJSON().content?.[0]?.content?.map((n) => n.marks ?? []) ?? [];

describe("formatting a selection", () => {
  it("highlights and colours the selected words", () => {
    const e = open("<p>un mot clé</p>");
    e.chain().setTextSelection({ from: 4, to: 7 }).toggleHighlight({ color: "#fef08a" }).setColor("#dc2626").run();
    expect(marksOf(e)[1]).toEqual(
      expect.arrayContaining([
        { type: "highlight", attrs: { color: "#fef08a" } },
        { type: "textStyle", attrs: expect.objectContaining({ color: "#dc2626" }) },
      ]),
    );
  });

  it("wraps the current paragraph in a callout or a toggle", () => {
    const e = open("<p>À retenir</p>");
    e.chain().setTextSelection(2).setCallout("tip").run();
    expect(e.getJSON().content?.[0]).toMatchObject({ type: "callout", attrs: { tone: "tip" } });
    e.chain().setTextSelection(3).setToggle().run();
    expect(e.getJSON().content?.[0]?.content?.[0]).toMatchObject({ type: "toggle", attrs: { open: true } });
  });

  it("turns a paragraph into a task to tick", () => {
    const e = open("<p>relancer</p>");
    e.chain().setTextSelection(2).toggleTaskList().run();
    expect(e.getJSON().content?.[0]).toMatchObject({
      type: "taskList",
      content: [{ type: "taskItem", attrs: { checked: false } }],
    });
  });
});
