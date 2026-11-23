import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { toDocx, type DocxNode } from "./docx";
import { kertasFrom } from "./engine";
import type { Table } from "./types";

function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, string>();
  let end = bytes.length - 22;
  while (view.getUint32(end, true) !== 0x06054b50) end--;
  let at = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    files.set(name, new TextDecoder().decode(method === 0 ? raw : inflateRawSync(raw)));
    at += 46 + nameLength + extra;
  }
  return files;
}

const t = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]): DocxNode => ({ type: "text", text, ...(marks ? { marks } : {}) });
const p = (...content: DocxNode[]): DocxNode => ({ type: "paragraph", content });
const h = (level: number, text: string): DocxNode => ({ type: "heading", attrs: { level }, content: [t(text)] });
const item = (...content: DocxNode[]): DocxNode => ({ type: "listItem", content });

const budget: Table = {
  columns: [
    { name: "Poste", property: { type: "text" } },
    { name: "Montant", property: { type: "money", currency: "EUR" } },
  ],
  rows: [
    [{ raw: "Visuels", display: "Visuels" }, { raw: "1200", display: "1 200,00 €", typed: { type: "money", minor: 120000, currency: "EUR" } }],
    [{ raw: "Vidéo", display: "Vidéo" }, { raw: "350,5", display: "350,50 €", typed: { type: "money", minor: 35050, currency: "EUR" } }],
  ],
};

const note: DocxNode = {
  type: "doc",
  content: [
    { type: "tableOfContents" },
    h(1, "Introduction"),
    p(t("Un texte "), t("gras", [{ type: "bold" }]), t(", "), t("italique", [{ type: "italic" }]), t(" et un "), t("lien", [{ type: "link", attrs: { href: "https://lalter.fr" } }]), t("."), { type: "footnote", attrs: { text: "Une note de bas de page." } }),
    h(2, "A. Les causes & les effets"),
    { type: "bulletList", content: [item(p(t("Premier point")), { type: "orderedList", attrs: { start: 1 }, content: [item(p(t("Sous-point numéroté")))] }), item(p(t("Second point")))] },
    { type: "orderedList", attrs: { start: 3 }, content: [item(p(t("Troisième")))] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("Écrire le plan"))] }, { type: "taskItem", attrs: { checked: false }, content: [p(t("Relire"))] }] },
    { type: "blockquote", content: [p(t("Une citation."))] },
    { type: "callout", attrs: { tone: "note" }, content: [p(t("Un encadré à retenir."))] },
    { type: "codeBlock", content: [t("const a = 1;\nconst b = 2;")] },
    { type: "horizontalRule" },
    { type: "collection", attrs: { table: budget as unknown as Record<string, unknown>, layout: { kind: "board" } } },
    { type: "blockMath", attrs: { latex: "e^{i\\pi}+1=0" } },
    { type: "linkPreview", attrs: { url: "https://ulule.com/kaiin", title: "Campagne Kaiin", description: "Soutenez le projet." } },
    { type: "image", attrs: { src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGO45mX8H4QBFIcEpTaHwZUAAAAASUVORK5CYII=", alt: "Point" } },
    h(1, "Conclusion"),
    p(t("Fin <du> texte.")),
  ],
};

const wasm = resolve(process.cwd(), "kertas/dist/kertas.wasm");

describe("a note as a Word file", async () => {
  const engine = existsSync(wasm) ? kertasFrom((await WebAssembly.instantiate(readFileSync(wasm), {})).instance, () => new Date(2026, 10, 13)) : null;
  const bytes = toDocx(note, { title: "Plan de la dissertation", engine });
  const files = unzip(bytes);
  const body = files.get("word/document.xml") ?? "";

  it("holds every part Word needs", () => {
    for (const part of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/numbering.xml", "word/footnotes.xml", "word/settings.xml", "word/_rels/document.xml.rels", "word/media/image1.png"]) {
      expect(files.has(part), part).toBe(true);
    }
  });

  it("keeps the outline in Word's heading styles, under the note's title", () => {
    expect(body).toContain('<w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">Plan de la dissertation');
    expect(body).toContain('<w:pStyle w:val="Heading1"/>');
    expect(body).toContain('<w:pStyle w:val="Heading2"/>');
    expect(body).toContain("A. Les causes &amp; les effets");
    expect(body).toContain(' TOC \\o "1-3"');
    expect(files.get("word/settings.xml")).toContain("updateFields");
  });

  it("writes marks, live links and footnotes", () => {
    expect(body).toContain("<w:b/></w:rPr><w:t xml:space=\"preserve\">gras");
    expect(body).toMatch(/<w:hyperlink r:id="rId\d+">/);
    expect(files.get("word/_rels/document.xml.rels")).toContain('Target="https://lalter.fr" TargetMode="External"');
    expect(body).toContain('<w:footnoteReference w:id="1"/>');
    expect(files.get("word/footnotes.xml")).toContain("Une note de bas de page.");
  });

  it("makes lists Word lists, restarting an ordered list at its own start", () => {
    expect(body).toMatch(/<w:numPr><w:ilvl w:val="1"\/><w:numId w:val="\d+"\/><\/w:numPr><\/w:pPr><w:r><w:t xml:space="preserve">Sous-point/);
    expect(files.get("word/numbering.xml")).toContain('<w:startOverride w:val="3"/>');
    expect(body).toContain("☑ ");
    expect(body).toContain("☐ ");
  });

  it("turns a table into a Word table with its header and its totals", () => {
    expect(body).toContain("<w:tblHeader/>");
    expect(body).toContain("1 200,00 €");
    if (engine) expect(body).toMatch(/1\s550,50\s€/);
  });

  it("escapes text and embeds pasted images", () => {
    expect(body).toContain("Fin &lt;du&gt; texte.");
    expect(body).toContain("<wp:extent cx=\"19050\" cy=\"9525\"/>");
  });

  it.skipIf(!process.env.KERTAS_DOCX_SAMPLE)("writes a sample to open in Word or LibreOffice", () => {
    const out = process.env.KERTAS_DOCX_SAMPLE as string;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, bytes);
  });
});
