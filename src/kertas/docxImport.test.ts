import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { toDocx } from "./docx";
import { fromDocx, withStoredImages } from "./docxImport";
import { kertasFrom } from "./engine";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';

function wordFile(body: string, extra: Record<string, Uint8Array> = {}) {
  return zipSync({
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`),
    "word/styles.xml": strToU8(
      `<w:styles ${W}><w:style w:type="paragraph" w:styleId="Titre"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Titre1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Titre2"><w:name w:val="heading 2"/></w:style><w:style w:type="paragraph" w:styleId="Citation"><w:name w:val="Quote"/></w:style></w:styles>`,
    ),
    "word/numbering.xml": strToU8(
      `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="3"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
    ),
    "word/_rels/document.xml.rels": strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="hyperlink" Target="https://lalter.fr/a?b=1&amp;c=2" TargetMode="External"/><Relationship Id="rId9" Type="image" Target="media/image1.png"/></Relationships>`,
    ),
    ...extra,
  });
}

const p = (inner: string, style = "", num = "") => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${num}</w:pPr>${inner}</w:p>`;
const r = (text: string, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const item = (level: number) => `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="3"/></w:numPr>`;

describe("Word import", () => {
  it("reads a Word document's title, headings, emphasis, links, lists, quotes and tables", () => {
    const doc = wordFile(
      [
        p(r("Compte rendu &amp; suites"), "Titre"),
        p(r("Contexte"), "Titre1"),
        p(r("Le budget est ") + r("validé", "<w:b/>") + r(", voir ") + `<w:hyperlink r:id="rId5">${r("le site", '<w:u w:val="single"/>')}</w:hyperlink>` + r(" et *rien* d’autre.")),
        p(`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://exemple.fr" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${r("un champ")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`),
        p(r("Étapes"), "Titre2"),
        p(r("Relire"), "", item(0)),
        p(r("le devis"), "", item(1)),
        p(r("Envoyer"), "", item(0)),
        p(r("Il faut savoir s’arrêter."), "Citation"),
        p(r("barré", "<w:strike/>") + r(" ") + r("surligné", '<w:highlight w:val="yellow"/>') + r(" ") + r("x = 1", '<w:rFonts w:ascii="Consolas"/>')),
        `<w:tbl><w:tr><w:tc>${p(r("Poste"))}</w:tc><w:tc>${p(r("Montant"))}</w:tc></w:tr><w:tr><w:tc>${p(r("Design | site"))}</w:tc><w:tc>${p(r("1 200 €"))}</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${p(r("Total à revoir"))}</w:tc></w:tr></w:tbl>`,
        p(r("# pas un titre")),
        p(`<w:r><w:tab/><w:tab/></w:r>${r("     D’UNE PART", "<w:b/>")}`),
        `<w:p><w:del><w:r><w:delText>supprimé</w:delText></w:r></w:del><w:ins><w:r><w:t>ajouté</w:t></w:r></w:ins></w:p>`,
      ].join(""),
    );
    const { title, markdown, images } = fromDocx(doc);
    expect(title).toBe("Compte rendu & suites");
    expect(images).toEqual([]);
    expect(markdown.split("\n\n")).toEqual([
      "# Contexte",
      "Le budget est **validé**, voir [le site](https://lalter.fr/a?b=1&c=2) et \\*rien\\* d’autre.",
      "[un champ](https://exemple.fr)",
      "## Étapes",
      "1. Relire\n   - le devis\n2. Envoyer",
      "> Il faut savoir s’arrêter.",
      "~~barré~~ ==surligné== `x = 1`",
      "| Poste | Montant |\n| --- | --- |\n| Design \\\\| site | 1 200 € |\n| Total à revoir |   |",
      "\\# pas un titre",
      "**D’UNE PART**",
      "ajouté",
    ]);
  });

  it("brings images out for the caller to store, and swaps them in once stored", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const drawing = `<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Image 1" descr="Le logo&#10;Description générée"/><a:graphic><a:graphicData><a:blip r:embed="rId9"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    const { markdown, images } = fromDocx(wordFile(p(r("Avant")) + p(drawing) + p(r("Après")), { "word/media/image1.png": png }));
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ placeholder: "docx-image:1", name: "image1.png", mime: "image/png" });
    expect([...images[0].bytes]).toEqual([...png]);
    expect(markdown).toBe("Avant\n\n![Le logo Description générée](docx-image:1)\n\nAprès");
    expect(withStoredImages(markdown, new Map([["docx-image:1", "resource:r-1"]]))).toBe("Avant\n\n![Le logo Description générée](resource:r-1)\n\nAprès");
    expect(withStoredImages(markdown, new Map())).toBe("Avant\n\nAprès");
  });

  it("reads back what kertas writes to Word", () => {
    const bytes = toDocx(
      {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Plan" }] },
          { type: "paragraph", content: [{ type: "text", text: "Un " }, { type: "text", text: "point", marks: [{ type: "italic" }] }, { type: "text", text: " clé." }] },
          {
            type: "bulletList",
            content: [
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Un" }] }] },
              { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Deux" }] }] },
            ],
          },
          { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Premier" }] }] }] },
          { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Cité" }] }] },
        ],
      },
      { title: "Ma note" },
    );
    const { title, markdown } = fromDocx(bytes);
    expect(title).toBe("Ma note");
    expect(markdown).toBe("## Plan\n\nUn *point* clé.\n\n- Un\n- Deux\n\n1. Premier\n\n> Cité");
  });

  it("refuses a file that is not a Word document", () => {
    expect(() => fromDocx(zipSync({ "hello.txt": strToU8("hi") }))).toThrow("not a Word document");
    expect(() => fromDocx(strToU8("not a zip"))).toThrow();
  });

  it("writes markdown the kertas engine reads back into headings, lists, quotes and a typed table", async (context) => {
    const wasm = resolve(process.cwd(), "kertas/dist/kertas.wasm");
    if (!existsSync(wasm)) return context.skip();
    const engine = kertasFrom((await WebAssembly.instantiate(readFileSync(wasm), {})).instance, () => new Date(2026, 10, 14));
    const { title, markdown } = fromDocx(
      wordFile(
        p(r("Note"), "Titre1") +
          p(r("Contexte"), "Titre2") +
          p(r("Relire"), "", item(0)) +
          p(r("Il faut savoir s’arrêter."), "Citation") +
          `<w:tbl><w:tr><w:tc>${p(r("Poste"))}</w:tc><w:tc>${p(r("Montant"))}</w:tc></w:tr><w:tr><w:tc>${p(r("Design"))}</w:tc><w:tc>${p(r("1 200 €"))}</w:tc></w:tr></w:tbl>`,
      ),
    );
    expect(title).toBe("Note");
    const doc = engine.fromMarkdown(markdown) as { content: { type: string }[] };
    expect(doc.content.map((n) => n.type)).toEqual(["heading", "orderedList", "blockquote", "collection"]);
  });
});
