// @vitest-environment happy-dom
import { getSchema } from "@tiptap/core";
import { DOMParser, DOMSerializer } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { Collection } from "./Collection";
import { formattingExtensions } from "./formatting";
import { mentionExtensions } from "./mentions";
import { writingExtensions } from "./writing";
import { KertasError, kertasFrom } from "./engine";
import { KertasMeasure } from "./measure";
import { PageRef } from "./pageRef";

const schema = getSchema([StarterKit.configure({ codeBlock: false, document: false }), Collection, KertasMeasure, PageRef, ...formattingExtensions, ...mentionExtensions, ...writingExtensions()]);

const table = {
  columns: [
    { name: "Mois", property: { type: "text" } },
    { name: "Montant", property: { type: "money", currency: "EUR" }, manual: true },
  ],
  rows: [[{ raw: "janvier", display: "janvier" }, { raw: "1 200 €", display: "1 200,00 €", typed: { type: "money", minor: 120000, currency: "EUR" } }]],
};

const doc = schema.nodeFromJSON({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Budget, voir " }, { type: "pageRef", attrs: { page: "p-2", title: "Hypothèses" } }] },
    { type: "collection", attrs: { id: "t-1", table, chart: { x: 0, y: 1 }, layout: { kind: "board", group: 0, lanes: ["janvier", "février"] } } },
    {
      type: "paragraph",
      content: [
        {
          type: "kertasMeasure",
          attrs: { table: "t-1", column: 1, columnName: "Montant", measure: "sum", lang: "fr", text: "Total (Montant) : 1 200,00 €", missing: false },
        },
      ],
    },
  ],
});

describe("a document saved as HTML and opened again", () => {
  it("keeps its tables, their ids, charts and views, live answers and page citations", () => {
    const holder = document.createElement("div");
    holder.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document }));
    const html = holder.innerHTML;

    const reopened = document.createElement("div");
    reopened.innerHTML = html;
    const again = DOMParser.fromSchema(schema).parse(reopened);

    expect(again.toJSON()).toEqual(doc.toJSON());
  });
});

const wasm = resolve(process.cwd(), "kertas/dist/kertas.wasm");

describe.skipIf(!existsSync(wasm))("a note stored as JSON with its Markdown view", async () => {
  const module = await WebAssembly.instantiate(readFileSync(wasm), {});
  const kertas = kertasFrom(module.instance, () => new Date(2026, 10, 11));

  it("writes the Markdown of every block, the table and the citation included", () => {
    const markdown = kertas.toMarkdown(doc.toJSON());
    expect(markdown).toContain("Budget, voir [Hypothèses](kertas:page/p-2)");
    expect(markdown).toContain("| Mois | Montant |");
    expect(markdown).toContain("Total (Montant) : 1 200,00 €");
  });

  it("records a note for the core and opens it again unchanged", () => {
    const record = kertas.recordNote(doc.toJSON());
    expect(record.version).toBe(1);
    expect(record.links).toEqual([
      { kind: "page", target: "p-2" },
      { kind: "table", target: "t-1" },
    ]);
    expect(kertas.openNote(record)).toEqual(doc.toJSON());
  });

  it("refuses a note written by a newer engine instead of opening it wrong", () => {
    const record = kertas.recordNote(doc.toJSON());
    expect(() => kertas.openNote({ version: record.version + 1, document: record.document })).toThrow(KertasError);
  });

  it("reads people and dates into mentions the editor accepts", () => {
    const note = "[@Marie Dupont](kertas:person/marie) rappelle [vendredi 13 novembre](kertas:date/2026-11-13) 🎉";
    const node = schema.nodeFromJSON(kertas.fromMarkdown(note));
    node.check();
    const kinds: string[] = [];
    node.descendants((child) => {
      kinds.push(child.type.name);
    });
    expect(kinds).toEqual(["paragraph", "personRef", "text", "dateRef", "text"]);
    expect(kertas.toMarkdown(node.toJSON())).toBe(note);
  });

  it("reads a table of contents, footnotes and an image into nodes the editor accepts", () => {
    const note = "[[_TOC_]]\n\n## Budget\n\nLe devis[^1] est prêt.\n\n![Le plan](https://exemple.fr/plan.png)\n\n[^1]: Hors taxes.";
    const node = schema.nodeFromJSON(kertas.fromMarkdown(note));
    node.check();
    expect(node.content.content.map((child) => child.type.name)).toEqual(["tableOfContents", "heading", "paragraph", "image"]);
    expect(kertas.toMarkdown(node.toJSON())).toBe(note);
  });

  it("reads formulas into math nodes the editor accepts", () => {
    const note = "Soit $x^2$ positif.\n\n$$\\frac{a}{b}$$";
    const node = schema.nodeFromJSON(kertas.fromMarkdown(note));
    node.check();
    expect(node.content.content.map((child) => child.type.name)).toEqual(["paragraph", "blockMath"]);
    expect(kertas.toMarkdown(node.toJSON())).toBe(note);
  });

  it("reads tasks, highlights, callouts and toggles into nodes the editor accepts", () => {
    const note =
      "Un mot ==surligné==.\n\n- [x] relancer\n- [ ] chiffrer\n\n> [!TIP]\n> Penser au café.\n\n<details>\n<summary>Détails</summary>\n\nPremier.\n\n</details>";
    const node = schema.nodeFromJSON(kertas.fromMarkdown(note));
    node.check();
    expect(node.content.content.map((child) => child.type.name)).toEqual(["paragraph", "taskList", "callout", "toggle"]);
    expect(kertas.toMarkdown(node.toJSON())).toBe(note);
  });

  it("reads an existing Markdown note into JSON the editor schema accepts", () => {
    const note = "# Réunion\n\nOn a **décidé** de voir [Hypothèses](kertas:page/p-2).\n\n- relancer\n- chiffrer\n\n| Client | Montant |\n| --- | --- |\n| Paul | 12 € |";
    const json = kertas.fromMarkdown(note);
    const node = schema.nodeFromJSON(json);
    node.check();
    expect(node.childCount).toBe(4);
    expect(kertas.toMarkdown(node.toJSON())).toBe(note.replace("| Paul | 12 € |", "| Paul | 12,00 € |"));
  });
});
