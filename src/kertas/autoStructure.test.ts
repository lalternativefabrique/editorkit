// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { AutoStructure, autoStructureKey } from "./AutoStructure";
import type { Kertas } from "./engine";

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const dirty = (e: Editor) => autoStructureKey.getState(e.state)?.dirty.length ?? -1;

describe("what kertas treats as writing", () => {
  it("leaves a document loaded by the host alone, and looks at what is typed", () => {
    editor = new Editor({ extensions: [StarterKit, AutoStructure.configure({ engine: {} as Kertas })], content: "<p></p>" });
    editor.commands.setContent("<p>une note rouverte</p><p>analyse le coût moyen ?</p>", { emitUpdate: false });
    expect(dirty(editor)).toBe(0);
    editor.commands.insertContentAt(1, "x");
    expect(dirty(editor)).toBeGreaterThan(0);
  });
});
