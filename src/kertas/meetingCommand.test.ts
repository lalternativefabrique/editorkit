// @vitest-environment happy-dom
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { kertasFrom } from "./engine";
import { meetingItems } from "./meetings";
import type { PlannedMeeting } from "./kertasLinks";

const wasm = resolve(import.meta.dirname, "../../kertas/dist/kertas.wasm");
const typed = "réunion Marc jeudi 14h";
let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe.runIf(existsSync(wasm))("planning a meeting from @", () => {
  const choose = async (plan: () => Promise<PlannedMeeting | null>, meanwhile?: (e: Editor) => void) => {
    const module = await WebAssembly.instantiate(readFileSync(wasm), {});
    const kertas = kertasFrom(module.instance, () => new Date(2026, 10, 11));
    editor = new Editor({ extensions: [StarterKit.configure({ link: { protocols: [{ scheme: "kertas", optionalSlashes: true }] } })], content: `<p>Avant @${typed}</p>` });
    let release: (value: PlannedMeeting | null) => void = () => {};
    const pending = new Promise<PlannedMeeting | null>((resolve) => (release = resolve));
    const [item] = meetingItems(kertas, () => pending)(typed);
    item.command({ editor, range: { from: 7, to: 8 + typed.length } } as never);
    meanwhile?.(editor);
    release(await plan().catch(() => null));
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    return editor;
  };

  it("keeps the typed words when the meeting could not be planned", async () => {
    const e = await choose(() => Promise.reject(new Error("offline")));
    expect(e.getText()).toBe(`Avant ${typed}`);
  });

  it("puts the meeting where the words were, even after typing elsewhere", async () => {
    const e = await choose(
      async () => ({ id: "e-1", title: "Réunion Marc", start: "2026-11-12T14:00" }),
      (ed) => ed.chain().insertContentAt(1, "Tout ").run(),
    );
    expect(e.getText()).toMatch(/^Tout Avant Réunion Marc · jeudi 12 novembre, 14:00 $/);
    expect(e.getHTML()).toContain('href="kertas:event/e-1?at=2026-11-12T14:00"');
  });
});
