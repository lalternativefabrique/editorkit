import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import { Collection } from "./Collection";
import { kertasFrom } from "./engine";
import { blockNodes } from "./nodes";

const wasm = fileURLToPath(new URL("../../kertas/dist/kertas.wasm", import.meta.url));

describe.skipIf(!existsSync(wasm))("raw text becomes a structured document", async () => {
  const module = await WebAssembly.instantiate(readFileSync(wasm), {});
  const kertas = kertasFrom(module.instance, () => new Date(2026, 10, 11));
  const schema = getSchema([StarterKit, Collection]);
  const build = (text: string) => blockNodes(schema, kertas.parse(text));

  it("keeps headings, inline marks, bullets and code", () => {
    const nodes = build(
      [
        "# Compte rendu",
        "Du **gras** et de l'*italique*.",
        "• un",
        "• deux",
        "function f(a) {",
        "  return a * 2;",
        "}",
      ].join("\n"),
    );
    expect(nodes.map((n) => n.type.name)).toEqual(["heading", "paragraph", "bulletList", "codeBlock"]);
    const marks = nodes[1].content.content.map((t) => `${t.text}:${t.marks.map((m) => m.type.name).join("+")}`);
    expect(marks).toEqual(["Du :", "gras:bold", " et de l':", "italique:italic", ".:"]);
    expect(nodes[3].attrs.language).toBe("javascript");
  });

  it("turns a table inside text into a collection", () => {
    const nodes = build("Stock :\nProduit\tPrix\nClavier\t49,90 €\nSouris\t19 €");
    expect(nodes.map((n) => n.type.name)).toEqual(["paragraph", "collection"]);
    expect(nodes[1].attrs.table.rows).toHaveLength(2);
  });

  it("builds nodes the schema accepts", () => {
    for (const node of build("> citation\n\n---\n\n1) a\n2) b\n\n~~barré~~ et [lien](https://a.fr)")) {
      expect(() => node.check()).not.toThrow();
    }
  });
});
