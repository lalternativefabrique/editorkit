// @vitest-environment happy-dom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { kertasFrom } from "./engine";
import { Recognize, mentionExtensions } from "./mentions";

const wasm = resolve(process.cwd(), "kertas/dist/kertas.wasm");

describe.skipIf(!existsSync(wasm))("days and people recognized while writing", async () => {
  const module = await WebAssembly.instantiate(readFileSync(wasm), {});
  const kertas = kertasFrom(module.instance, () => new Date(2026, 10, 11));
  const people = [
    { id: "marie", name: "Marie Dupont" },
    { id: "karim", name: "Karim Benali" },
  ];
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  const open = (text: string) => {
    editor = new Editor({
      extensions: [StarterKit, ...mentionExtensions, Recognize.configure({ engine: kertas, people: () => people })],
      content: `<p>${text}</p>`,
    });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    return editor;
  };
  const underlined = (e: Editor) => [...e.view.dom.querySelectorAll(".kertas-recognized")].map((n) => n.textContent);
  const tab = (e: Editor) => e.view.someProp("handleKeyDown", (f) => f(e.view, new KeyboardEvent("keydown", { key: "Tab" })));

  it("underlines the days and people of the paragraph being written", () => {
    expect(underlined(open("Envoyer le devis à Marie jeudi prochain"))).toEqual(["Marie", "jeudi prochain"]);
  });

  it("makes the one before the cursor a mention on Tab", () => {
    const e = open("Envoyer le devis jeudi prochain");
    expect(tab(e)).toBe(true);
    expect(e.getJSON().content?.[0]?.content?.at(-1)).toEqual({ type: "dateRef", attrs: { date: "2026-11-12", label: "jeudi 12 novembre" } });
    expect(underlined(e)).toEqual([]);
  });

  it("leaves Tab alone when nothing is right before the cursor", () => {
    const e = open("Jeudi prochain, on verra");
    expect(underlined(e)).toEqual(["Jeudi prochain"]);
    expect(tab(e)).toBeFalsy();
  });

  it("knows a person by the first name alone when only one has it", () => {
    const e = open("Appeler Karim");
    tab(e);
    expect(e.getJSON().content?.[0]?.content?.at(-1)).toEqual({ type: "personRef", attrs: { person: "karim", name: "Karim Benali" } });
  });
});
