import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { kertasFrom } from "./engine";
import { convert, headingFor, indent, joinBackward, paragraphRow, shortcut, split, tidyRow, toDocument, toRows, type DocNode, type Row } from "./rows";

const wasm = resolve(process.cwd(), "kertas/dist/kertas.wasm");

const text = (value: string, marks?: DocNode["marks"]): DocNode => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const p = (id: string, ...content: DocNode[]): DocNode => ({ type: "paragraph", attrs: { id }, ...(content.length ? { content } : {}) });
const item = (id: string, inner: string, words: string, ...nested: DocNode[]): DocNode => ({
  type: "listItem",
  attrs: { id },
  content: [p(inner, text(words)), ...nested],
});

const document: DocNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { id: "h", level: 2, textAlign: null }, content: [text("Plan")] },
    p("p1", text("Un "), text("point", [{ type: "bold" }]), text(" et un "), text("lien", [{ type: "link", attrs: { href: "https://a.fr" } }])),
    p("empty"),
    {
      type: "bulletList",
      attrs: { id: "l" },
      content: [item("i1", "i1p", "Devis", { type: "orderedList", attrs: { id: "l2", start: 1 }, content: [item("i2", "i2p", "Relire")] }), item("i3", "i3p", "Facture")],
    },
    {
      type: "taskList",
      attrs: { id: "t" },
      content: [{ type: "taskItem", attrs: { id: "t1", checked: true }, content: [p("t1p", text("Envoyer"))] }],
    },
    { type: "blockquote", attrs: { id: "q" }, content: [p("qp", text("Cité"))] },
    { type: "callout", attrs: { id: "c", tone: "tip" }, content: [p("cp", text("Astuce"))] },
    { type: "codeBlock", attrs: { id: "code", language: "ts" }, content: [text("const a = 1;\nconst b = 2;")] },
    { type: "horizontalRule", attrs: { id: "hr" } },
    { type: "kertasTable", attrs: { id: "tb", table: { columns: [], rows: [] } } },
    p("u", text("souligné", [{ type: "underline" }])),
  ],
};

describe.skipIf(!existsSync(wasm))("a document as rows", async () => {
  const module = await WebAssembly.instantiate(readFileSync(wasm), {});
  const kertas = kertasFrom(module.instance, () => new Date(2026, 10, 12));

  it("flattens lists with their depth and edits text as inline Markdown", () => {
    const rows = toRows(kertas, document);
    expect(rows.map((row) => [row.kind, row.depth ?? null, row.text])).toEqual([
      ["heading", null, "Plan"],
      ["paragraph", null, "Un **point** et un [lien](https://a.fr)"],
      ["paragraph", null, ""],
      ["bullet", 0, "Devis"],
      ["ordered", 1, "Relire"],
      ["bullet", 0, "Facture"],
      ["task", 0, "Envoyer"],
      ["quote", null, "Cité"],
      ["callout", null, "Astuce"],
      ["code", null, "const a = 1;\nconst b = 2;"],
      ["divider", null, ""],
      ["locked", null, ""],
      ["locked", null, ""],
    ]);
  });

  it("writes back exactly the document it read", () => {
    expect(toDocument(kertas, toRows(kertas, document), document)).toEqual(document);
  });

  it("keeps a block it cannot edit, its marks included, untouched", () => {
    const rows = toRows(kertas, document);
    expect(rows.at(-1)?.node).toBe(document.content?.at(-1));
  });

  it("writes new rows with ids, a list item continuing its list", () => {
    const rows = toRows(kertas, document);
    const edit = split(rows, 5, "Facture", " envoyée");
    const written = toDocument(kertas, edit.rows);
    const list = written.content?.[3];
    expect(list?.content?.map((entry) => entry.content?.[0].content?.[0].text)).toEqual(["Devis", "Facture", "envoyée"]);
    expect(typeof list?.content?.[2].attrs?.id).toBe("string");
    expect(edit.focus).toBe(6);
  });

  it("ends the list when Return is pressed on an empty item", () => {
    const rows: Row[] = [{ id: "a", kind: "bullet", text: "", depth: 0 }];
    expect(split(rows, 0, "", "").rows[0].kind).toBe("paragraph");
  });

  it("turns opening characters into a block, as Markdown reads them", () => {
    expect(shortcut(paragraphRow("## Titre"))).toMatchObject({ kind: "heading", level: 2, text: "Titre" });
    expect(shortcut(paragraphRow("[] courses"))).toMatchObject({ kind: "task", checked: false, text: "courses" });
    expect(shortcut(paragraphRow("- point"))).toMatchObject({ kind: "bullet", depth: 0, text: "point" });
    expect(shortcut(paragraphRow("---"))).toMatchObject({ kind: "divider", text: "" });
    expect(shortcut(paragraphRow("pas un - titre"))).toBeNull();
  });

  it("joins a paragraph into the text above when Backspace opens it", () => {
    const rows: Row[] = [paragraphRow("Bon"), paragraphRow("jour")];
    expect(joinBackward(rows, 1)).toMatchObject({ focus: 0, caret: 3, rows: [{ text: "Bonjour" }] });
    const heading = convert(paragraphRow("Titre"), "heading", 1);
    expect(joinBackward([heading], 0)?.rows[0].kind).toBe("paragraph");
  });

  it("indents an item no deeper than one below the item above", () => {
    const rows: Row[] = [
      { id: "a", kind: "bullet", text: "a", depth: 0 },
      { id: "b", kind: "bullet", text: "b", depth: 0 },
    ];
    expect(indent(rows, 1, 1)[1].depth).toBe(1);
    expect(indent(indent(rows, 1, 1), 1, 1)[1].depth).toBe(1);
    expect(indent(rows, 0, 1)[0].depth).toBe(0);
  });

  it("reads back what it writes from Markdown typed on the phone", () => {
    const rows = [paragraphRow("Un **gras** et ~~barré~~")];
    expect(toRows(kertas, toDocument(kertas, rows))[0].text).toBe("Un **gras** et ~~barré~~");
  });

  it("keeps a link the desktop wrote editable, with its attributes intact", () => {
    const link = { type: "link", attrs: { href: "https://a.fr", target: "_blank", rel: "noopener noreferrer nofollow", class: null } };
    const written: DocNode = { type: "doc", content: [p("w", text("voir "), text("le site", [link]))] };
    const rows = toRows(kertas, written);
    expect(rows[0]).toMatchObject({ kind: "paragraph", text: "voir [le site](https://a.fr)" });
    expect(toDocument(kertas, rows)).toEqual(written);
    const edited = toDocument(kertas, [{ ...rows[0], text: "Voir [le site](https://a.fr) demain" }]);
    expect(edited.content?.[0].content?.[1]).toEqual(text("le site", [link]));
  });

  it("tidies a row's typography and, on its first leave, marks what stands out", () => {
    const row = { ...paragraphRow("Budget: 1200 euros ... c'est urgent"), id: "t" };
    const tidied = tidyRow(kertas, row, true)?.text;
    expect(tidied).toContain("**Budget");
    expect(tidied).toContain("…");
    expect(tidied).toContain("c’est");
    expect(tidyRow(kertas, row, false)?.text).not.toContain("**");
    expect(tidyRow(kertas, { ...row, text: "déjà **gras** ici:" }, true)).toBeNull();
    expect(tidyRow(kertas, { ...row, text: "Rien à reprendre" }, true)).toBeNull();
  });

  it("corrects the misspellings its dictionaries are sure of, except a word put back", () => {
    for (const lang of ["fr", "en"] as const) {
      const folder = resolve(process.cwd(), `node_modules/dictionary-${lang}/`);
      kertas.loadDictionary(lang, readFileSync(`${folder}/index.aff`, "utf8"), readFileSync(`${folder}/index.dic`, "utf8"));
    }
    const row = { ...paragraphRow("un systeme tres rapide"), id: "s" };
    const tidied = tidyRow(kertas, row, false);
    expect(tidied?.text).toBe("un système très rapide");
    expect(tidied?.corrected).toEqual([
      { original: "systeme", replacement: "système" },
      { original: "tres", replacement: "très" },
    ]);
    expect(tidyRow(kertas, row, false, new Set(["systeme"]))?.text).toBe("un systeme très rapide");
  });

  describe("finding headings by the rules of written documents", () => {
    const body = "Ce paragraphe développe le point avec assez de texte pour être une vraie section du document.";
    const para = (text: string): Row => ({ ...paragraphRow(text), id: text });
    const head = (text: string, level: number): Row => ({ id: text, kind: "heading", text, level });
    const guess = (rows: Row[], line: string) => {
      const found = headingFor(kertas, [...rows, para(line), para(body)], rows.length);
      return found && { level: found.level, sure: found.sure };
    };

    it("reads an essay's parts, sub-parts and their numbering", () => {
      expect(guess([], "Introduction")).toEqual({ level: 1, sure: true });
      const intro = [head("Introduction", 1), para(body)];
      expect(guess(intro, "I. Les causes de la crise")).toEqual({ level: 1, sure: true });
      const part = [...intro, head("I. Les causes de la crise", 1), para(body)];
      expect(guess(part, "A. Les causes économiques")).toEqual({ level: 2, sure: true });
      const sub = [...part, head("A. Les causes économiques", 2), para(body)];
      expect(guess(sub, "1. Le chômage")).toEqual({ level: 3, sure: true });
      expect(guess(sub, "B. Les causes sociales")).toEqual({ level: 2, sure: true });
      expect(guess(sub, "Conclusion")).toEqual({ level: 1, sure: true });
    });

    it("takes a number typed without a dot or a capital as a sub-part, but not a list's next line", () => {
      const parts = [head("A. Les causes économiques", 1), para(body), head("B. Les causes sociales", 1)];
      expect(guess(parts, "1 le chômage des jeunes")).toEqual({ level: 2, sure: true });
      expect(headingFor(kertas, [para("1 kilo de farine"), para("2 œufs frais du marché")], 0)).toBeNull();
    });

    it("reads a report's decimal numbering as its depth", () => {
      expect(guess([], "1. Contexte du projet")).toEqual({ level: 1, sure: true });
      const report = [head("1. Contexte du projet", 1), para(body)];
      expect(guess(report, "1.1 Historique")).toEqual({ level: 2, sure: true });
      expect(guess([...report, head("1.1 Historique", 2), para(body)], "1.1.1 Les premières versions")).toEqual({ level: 3, sure: true });
    });

    it("knows the sections minutes and reports keep coming back to", () => {
      expect(guess([], "Ordre du jour")).toEqual({ level: 1, sure: true });
      expect(guess([head("Ordre du jour", 1), para(body)], "Prochaines étapes")).toEqual({ level: 1, sure: true });
      expect(guess([], "Décisions :")?.sure).toBe(true);
    });

    it("guesses a plain heading from the outline above it, without being sure", () => {
      expect(guess([], "Campagne Ulule")).toEqual({ level: 1, sure: false });
      expect(guess([head("Campagne Ulule", 1)], "Les visuels du lancement")).toEqual({ level: 2, sure: false });
      expect(guess([head("Campagne Ulule", 1), para(body), para(body)], "Les visuels du lancement")).toEqual({ level: 1, sure: false });
    });

    it("leaves sentences, questions and spoken asides as paragraphs", () => {
      for (const line of ["Bon si je fais une tirée", "On se voit demain", "Merci à tous", "Pourquoi Ulule ?", "il faut appeler Sam", "Il a plu toute la journée."]) {
        expect(guess([], line), line).toBeNull();
      }
    });

    it("reads a lone numbered item over a paragraph as a numbered heading", () => {
      const item: Row = { id: "n", kind: "ordered", text: "Contexte du projet", depth: 0, list: { start: 2 } };
      expect(headingFor(kertas, [item, para(body)], 0)).toEqual({ level: 1, sure: true, text: "2. Contexte du projet" });
      const list: Row[] = [{ ...item, id: "a", list: { start: 1 } }, { ...item, id: "b" }];
      expect(headingFor(kertas, [...list, para(body)], 1)).toBeNull();
    });

    it("needs the text the heading stands over", () => {
      expect(headingFor(kertas, [para("Introduction")], 0)).toBeNull();
      expect(headingFor(kertas, [para("Introduction"), para("")], 0)).toBeNull();
    });
  });
});
