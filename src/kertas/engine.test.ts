import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { KertasError, kertasFrom, kertasFromCall } from "./engine";
import { topicItems } from "./topics";

const wasm = fileURLToPath(new URL("../../kertas/dist/kertas.wasm", import.meta.url));

describe.skipIf(!existsSync(wasm))("kertas engine over wasm", async () => {
  const module = await WebAssembly.instantiate(readFileSync(wasm), {});
  const kertas = kertasFrom(module.instance, () => new Date(2026, 10, 11));
  const loadBoth = () => {
    for (const lang of ["fr", "en"] as const) {
      const folder = fileURLToPath(new URL(`../../node_modules/dictionary-${lang}/`, import.meta.url));
      kertas.loadDictionary(lang, readFileSync(`${folder}index.aff`, "utf8"), readFileSync(`${folder}index.dic`, "utf8"));
    }
  };

  it("reads a spreadsheet paste into a typed table", () => {
    const block = kertas.classify("Client\tMontant\nPaul\t1 200,50 €\nAnne\t850 €");
    expect(block.kind).toBe("table");
    if (block.kind !== "table") return;
    expect(block.table.columns[1].property).toEqual({ type: "money", currency: "EUR" });
    expect(kertas.view(block.table).totals[1]?.values).toEqual([{ type: "money", minor: 205050, currency: "EUR" }]);
  });

  it("exports CSV with the separator spreadsheets expect in the note's language", () => {
    const block = kertas.classify("Mois\tMontant\nfévrier\t3 000 €");
    if (block.kind !== "table") throw new Error(block.kind);
    kertas.language = "fr";
    expect(kertas.exportTable(block.table, "csv")).toBe("Mois;Montant\r\nfévrier;3 000 €\r\n");
    kertas.language = "en";
    expect(kertas.exportTable(block.table, "csv")).toBe("Mois,Montant\r\nfévrier,3 000 €\r\n");
    kertas.language = "fr";
  });

  it("dates a day without a year in the current year", () => {
    const [value] = kertas.typeValues(["12/03"], { type: "date" });
    expect(value.typed).toEqual({ type: "date", iso: "2026-03-12" });
  });

  it("reports offsets ProseMirror can use", () => {
    expect(kertas.normalize("🎉 Super!")).toEqual([{ from: 8, to: 8, insert: " " }]);
  });

  it("picks bold or italic from the sentence", () => {
    const text = "Attention : c’est a priori à rendre avant le 14 novembre.";
    const marks = kertas.emphasize(text).map((e) => [e.mark, text.slice(e.from, e.to)]);
    expect(marks).toEqual([
      ["bold", "Attention :"],
      ["italic", "a priori"],
      ["bold", "avant le 14 novembre"],
    ]);
  });

  it("corrects sure spelling mistakes and flags the rest", () => {
    loadBoth();
    const found = kertas.spell("un systeme tres rapide, touhours prquo à Marseille");
    expect(found.map((m) => [m.word, m.correction])).toEqual([
      ["systeme", "système"],
      ["tres", "très"],
      ["touhours", "toujours"],
      ["prquo", null],
    ]);
    expect(kertas.suggest("prquo", "fr")).toContain("pourquoi");
  });

  it("never applies the French dictionary to English", () => {
    loadBoth();
    const found = kertas.spell("The meeting is on Monday, can you send the reprot before noon?");
    expect(found.map((m) => [m.word, m.correction, m.lang])).toEqual([["reprot", "report", "en"]]);
    expect(kertas.normalize("Can you send it before noon?")).toEqual([]);
  });

  it("turns one line of records into a table and charts it", () => {
    const block = kertas.classify("paul 10 le lundi, fred 20 le mercredi, jean 100 demain");
    expect(block.kind).toBe("table");
    if (block.kind !== "table") return;
    expect(block.table.columns.map((c) => c.name)).toEqual(["Nom", "Nombre", "Date"]);
    const chart = kertas.chart(block.table);
    expect(chart?.axis).toBe("time");
    expect(chart?.points.map((p) => [p.label, p.value])).toEqual([
      ["11/11/2026", 20],
      ["12/11/2026", 100],
      ["16/11/2026", 10],
    ]);
  });

  it("computes a live measure from a table and a column", () => {
    const block = kertas.classify("Mois\tMontant\njanvier\t1 200 €\nfévrier\t900 €");
    if (block.kind !== "table") throw new Error(block.kind);
    expect(kertas.measure(block.table, 1, "mean", "fr")?.text).toBe("Moyenne (Montant)\u00a0: 1\u202f050,00\u00a0€ sur 2 lignes");
    expect(kertas.measure(block.table, 1, "mean", "en")?.text).toBe("Average (Montant): 1\u202f050,00\u00a0€ over 2 rows");
    expect(kertas.measure(block.table, 0, "sum", "fr")).toBeNull();
  });

  it("understands an agenda line like the schedule screen", () => {
    const moment = kertas.understand("Dentiste jeudi 16h");
    expect([moment.kind, moment.day, moment.hour, moment.minute, moment.title]).toEqual(["appointment", "2026-11-12", 16, 0, "Dentiste"]);
  });

  it("finds the pages and tables a document links to", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "pageRef", attrs: { page: "p-2", title: "Hypothèses" } }, { type: "kertasMeasure", attrs: { table: "t-1" } }] }],
    };
    expect(kertas.links(doc)).toEqual([
      { kind: "page", target: "p-2" },
      { kind: "table", target: "t-1" },
    ]);
  });

  it("surfaces engine errors", () => {
    expect(() => kertas.typeValues(["x"], { type: "nope" } as never)).toThrow(KertasError);
  });

  it("finds what it was given to index, and follows what changes", () => {
    expect(
      kertas.reindex([
        { kind: "note", id: "n1", title: "Budget asso 2027", text: "La ligne communication passe à 1 200 €.", at: "2026-11-13T10:00:00Z" },
        { kind: "appointment", id: "a1", title: "Point budget avec la trésorière", at: "2026-11-14T14:00:00Z" },
      ]),
    ).toBe(2);
    expect(kertas.find("bugdet", [], 5).map((h) => h.id)).toEqual(["a1", "n1"]);
    expect(kertas.find("communic", ["note"], 5)).toEqual([
      { kind: "note", id: "n1", title: "Budget asso 2027", snippet: "La ligne communication passe à 1 200 €.", at: "2026-11-13T10:00:00Z", url: "", tags: [], facts: [], linked: [] },
    ]);
    expect(kertas.indexChange([{ kind: "reminder", id: "r1", title: "Payer la trésorière" }], [{ kind: "appointment", id: "a1" }])).toBe(2);
    expect(kertas.find("tresor", [], 5).map((h) => h.id)).toEqual(["r1"]);
  });

  it("names what a found item cites and what cites it, and finds a note by its tag", () => {
    kertas.reindex([
      { kind: "note", id: "n1", title: "Budget 2027", tags: ["asso"], links: [{ kind: "appointment", id: "a1" }, { kind: "reminder", id: "a1" }] },
      { kind: "appointment", id: "a1", title: "Point trésorière", at: "2026-11-14T14:00:00Z" },
    ]);
    const [note] = kertas.find("asso", [], 5);
    expect(note).toMatchObject({ id: "n1", tags: ["asso"], linked: [{ kind: "appointment", id: "a1", title: "Point trésorière", at: "2026-11-14T14:00:00Z" }] });
    expect(kertas.find("tresor", [], 5)[0].linked).toEqual([{ kind: "note", id: "n1", title: "Budget 2027", at: "" }]);
  });

  it("offers, for a typed topic, the tags that start like it and the kept pages that speak of it", () => {
    kertas.reindex([
      { kind: "note", id: "n1", title: "Budget 2027", tags: ["budget-prévisionnel"] },
      { kind: "source", id: "s1", title: "Construire le budget prévisionnel", url: "https://example.org/budget", tags: ["Vie asso"] },
    ]);
    const items = topicItems(kertas)("Budget-prévi");
    expect(items.map((i) => [i.title, i.shortcut])).toEqual([
      ["#budget-prévisionnel", "1 note · 1 en littérature"],
      ["Construire le budget prévisionnel", "Littérature"],
    ]);
    expect(items[1].description).toBe("Déjà dans ta littérature sur « Budget-prévi »");
    expect(topicItems(kertas)("vie").map((i) => [i.title, i.shortcut])).toEqual([
      ["#Vie-asso", "1 en littérature"],
      ["Construire le budget prévisionnel", "Littérature"],
    ]);
    expect(topicItems(kertas)("")).toEqual([]);
  });

  it("survives many calls without leaking its memory", () => {
    const text = "Il a dit \"oui\" : l'été...".repeat(50);
    const memory = module.instance.exports.memory as WebAssembly.Memory;
    kertas.normalize(text);
    const before = memory.buffer.byteLength;
    for (let i = 0; i < 2000; i++) kertas.normalize(text);
    expect(memory.buffer.byteLength - before).toBeLessThan(1 << 20);
  });
});

describe("kertas over any transport", () => {
  it("sends the same JSON request to a native call", () => {
    const sent: string[] = [];
    const kertas = kertasFromCall((request) => {
      sent.push(request);
      return JSON.stringify({ ok: [] });
    }, () => new Date(2026, 10, 11));
    expect(kertas.normalize("Salut!")).toEqual([]);
    expect(JSON.parse(sent[0])).toEqual({ op: "normalize", text: "Salut!", lang: "fr" });
  });

  it("surfaces a native error", () => {
    const kertas = kertasFromCall(() => JSON.stringify({ error: "boom" }));
    expect(() => kertas.normalize("x")).toThrow(KertasError);
  });
});
