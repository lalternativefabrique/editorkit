import type { Kertas } from "./engine";
import type { Table } from "./types";
import { zip, type ZipEntry } from "./zip";

export interface DocxNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocxNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface DocxOptions {
  /** The note's title, set above its body in the Title style. */
  title?: string;
  /** Computes a table's totals, as the editor shows them. */
  engine?: Kertas | null;
  lang?: "fr" | "en";
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const DRAWING =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const BULLETS = ["•", "◦", "▪"];
const MAX_IMAGE_EMU = 5_760_000;
const EMU_PER_PX = 9525;
const LIST_INDENT = 360;

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const str = (value: unknown) => (typeof value === "string" ? value : value === undefined || value === null ? "" : String(value));

function imageSize(bytes: Uint8Array, kind: "png" | "jpeg"): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (kind === "png" && bytes.length > 24) return { width: view.getUint32(16), height: view.getUint32(20) };
  let at = 2;
  while (kind === "jpeg" && at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    const length = view.getUint16(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
    at += 2 + length;
  }
  return null;
}

function fromDataUrl(src: string): { bytes: Uint8Array; kind: "png" | "jpeg" } | null {
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(src);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, kind: match[1].toLowerCase() === "png" ? "png" : "jpeg" };
}

class Writer {
  body: string[] = [];
  rels: { id: string; type: string; target: string; external?: boolean }[] = [];
  media: ZipEntry[] = [];
  footnotes: string[] = [];
  nums: { abstract: number; start: number }[] = [];
  headings: { level: number; text: string }[] = [];
  private bookmark = 0;

  constructor(private readonly options: DocxOptions) {}

  rel(type: string, target: string, external = false): string {
    const id = `rId${this.rels.length + 10}`;
    this.rels.push({ id, type, target, external });
    return id;
  }

  newNum(ordered: boolean, start: number): number {
    this.nums.push({ abstract: ordered ? 2 : 1, start });
    return this.nums.length;
  }

  runs(nodes: DocxNode[] = [], base = ""): string {
    return nodes.map((node) => this.inline(node, base)).join("");
  }

  private inline(node: DocxNode, base: string): string {
    switch (node.type) {
      case "text":
        return this.textRun(node, base);
      case "hardBreak":
        return "<w:r><w:br/></w:r>";
      case "inlineMath":
        return `<w:r><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:i/></w:rPr><w:t xml:space="preserve">${escape(str(node.attrs?.latex))}</w:t></w:r>`;
      case "footnote": {
        this.footnotes.push(str(node.attrs?.text));
        return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${this.footnotes.length}"/></w:r>`;
      }
      default: {
        const attrs = node.attrs ?? {};
        const label = str(attrs.title || attrs.label || attrs.text || attrs.name || attrs.display || attrs.value);
        if (node.content) return this.runs(node.content, base);
        return label ? `<w:r>${base ? `<w:rPr>${base}</w:rPr>` : ""}<w:t xml:space="preserve">${escape(label)}</w:t></w:r>` : "";
      }
    }
  }

  private textRun(node: DocxNode, base: string): string {
    let props = base;
    let href: string | null = null;
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") props += "<w:b/>";
      else if (mark.type === "italic") props += "<w:i/>";
      else if (mark.type === "strike") props += "<w:strike/>";
      else if (mark.type === "underline") props += '<w:u w:val="single"/>';
      else if (mark.type === "code") props += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F1F1EF"/>';
      else if (mark.type === "highlight") props += '<w:highlight w:val="yellow"/>';
      else if (mark.type === "textStyle" && typeof mark.attrs?.color === "string" && /^#?[0-9a-f]{6}$/i.test(mark.attrs.color)) props += `<w:color w:val="${mark.attrs.color.replace("#", "")}"/>`;
      else if (mark.type === "link" && typeof mark.attrs?.href === "string") href = mark.attrs.href;
    }
    const text = (node.text ?? "").split("\n").map((part) => `<w:t xml:space="preserve">${escape(part)}</w:t>`).join("<w:br/>");
    if (!href) return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${text}</w:r>`;
    const id = this.rel("http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", href, true);
    return `<w:hyperlink r:id="${id}"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/>${props}</w:rPr>${text}</w:r></w:hyperlink>`;
  }

  paragraph(runs: string, props = ""): void {
    this.body.push(`<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${runs}</w:p>`);
  }

  private align(node: DocxNode): string {
    const align = node.attrs?.textAlign;
    return align === "center" ? '<w:jc w:val="center"/>' : align === "right" ? '<w:jc w:val="right"/>' : align === "justify" ? '<w:jc w:val="both"/>' : "";
  }

  blocks(nodes: DocxNode[] = [], style = ""): void {
    for (const node of nodes) this.block(node, style);
  }

  block(node: DocxNode, style = ""): void {
    const styled = style ? `<w:pStyle w:val="${style}"/>` : "";
    switch (node.type) {
      case "paragraph":
        this.paragraph(this.runs(node.content), styled + this.align(node));
        return;
      case "heading": {
        const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
        const text = (node.content ?? []).map((n) => n.text ?? "").join("");
        const name = `_Toc${++this.bookmark}`;
        this.headings.push({ level, text });
        this.paragraph(
          `<w:bookmarkStart w:id="${this.bookmark}" w:name="${name}"/>${this.runs(node.content)}<w:bookmarkEnd w:id="${this.bookmark}"/>`,
          `<w:pStyle w:val="Heading${level}"/>${this.align(node)}`,
        );
        return;
      }
      case "bulletList":
      case "orderedList":
        this.list(node, 0, this.newNum(node.type === "orderedList", Number(node.attrs?.start ?? 1)));
        return;
      case "taskList":
        this.tasks(node, 0);
        return;
      case "blockquote":
        this.blocks(node.content, "Quote");
        return;
      case "callout":
        this.blocks(node.content, "Callout");
        return;
      case "codeBlock": {
        const lines = (node.content ?? []).map((n) => n.text ?? "").join("").split("\n");
        this.paragraph(lines.map((line) => `<w:t xml:space="preserve">${escape(line)}</w:t>`).join("<w:br/>").replace(/^/, "<w:r>") + "</w:r>", '<w:pStyle w:val="Code"/>');
        return;
      }
      case "horizontalRule":
        this.paragraph("", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr>');
        return;
      case "blockMath":
        this.paragraph(`<w:r><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:i/></w:rPr><w:t xml:space="preserve">${escape(str(node.attrs?.latex))}</w:t></w:r>`, '<w:jc w:val="center"/>');
        return;
      case "image":
        this.image(node);
        return;
      case "linkPreview": {
        const url = str(node.attrs?.url);
        const title = str(node.attrs?.title) || url;
        const link = this.textRun({ type: "text", text: title, marks: [{ type: "link", attrs: { href: url } }, { type: "bold" }] }, "");
        const description = str(node.attrs?.description);
        this.paragraph(link + (description ? `<w:r><w:br/><w:t xml:space="preserve">${escape(description)}</w:t></w:r>` : ""), '<w:pStyle w:val="Callout"/>');
        return;
      }
      case "pdf":
        this.paragraph(`<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">PDF : ${escape(str(node.attrs?.name))}</w:t></w:r>`, '<w:pStyle w:val="Callout"/>');
        return;
      case "excerpt": {
        const source = node.attrs?.kind === "web" ? `${str(node.attrs?.name)}, ${str(node.attrs?.url)}` : `${str(node.attrs?.name)}, p. ${Number(node.attrs?.page ?? 1)}`;
        if (node.attrs?.kind === "figure") {
          this.paragraph(`<w:r><w:t xml:space="preserve">Figure — ${escape(source)}</w:t></w:r>`, '<w:pStyle w:val="Quote"/>');
          return;
        }
        this.paragraph(
          `<w:r><w:t xml:space="preserve">« ${escape(str(node.attrs?.quote))} »</w:t></w:r><w:r><w:br/><w:t xml:space="preserve">— ${escape(source)}</w:t></w:r>`,
          '<w:pStyle w:val="Quote"/>',
        );
        return;
      }
      case "collection":
        this.table((node.attrs?.table as Table | undefined) ?? { columns: [], rows: [] });
        return;
      case "tableOfContents":
        this.body.push("\u0000TOC\u0000");
        return;
      case "toggle": {
        const [summary, ...rest] = node.content ?? [];
        if (summary) this.paragraph(this.runs(summary.content, "<w:b/>"), styled);
        this.blocks(rest, style);
        return;
      }
      default:
        if (node.content?.some((child) => child.type === "text")) this.paragraph(this.runs(node.content), styled);
        else this.blocks(node.content, style);
    }
  }

  private list(node: DocxNode, depth: number, num: number): void {
    for (const item of node.content ?? []) {
      let first = true;
      for (const child of item.content ?? []) {
        if (child.type === "bulletList" || child.type === "orderedList") {
          this.list(child, depth + 1, child.type === "orderedList" ? this.newNum(true, Number(child.attrs?.start ?? 1)) : num);
        } else if (child.type === "taskList") {
          this.tasks(child, depth + 1);
        } else if (first && child.type === "paragraph") {
          this.paragraph(this.runs(child.content), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${Math.min(depth, 8)}"/><w:numId w:val="${num}"/></w:numPr>`);
          first = false;
        } else {
          this.paragraph(this.runs(child.content), `<w:pStyle w:val="ListParagraph"/><w:ind w:left="${(depth + 1) * LIST_INDENT * 2}"/>`);
        }
      }
    }
  }

  private tasks(node: DocxNode, depth: number): void {
    for (const item of node.content ?? []) {
      const box = item.attrs?.checked ? "☑" : "☐";
      let first = true;
      for (const child of item.content ?? []) {
        if (child.type === "taskList") this.tasks(child, depth + 1);
        else if (child.type === "bulletList" || child.type === "orderedList") this.list(child, depth + 1, this.newNum(child.type === "orderedList", 1));
        else {
          const prefix = first ? `<w:r><w:t xml:space="preserve">${box} </w:t></w:r>` : "";
          const done = item.attrs?.checked ? '<w:strike/><w:color w:val="8A8A93"/>' : "";
          this.paragraph(prefix + this.runs(child.content, done), `<w:pStyle w:val="ListParagraph"/><w:ind w:left="${(depth + 1) * LIST_INDENT * 2}" w:hanging="${LIST_INDENT}"/>`);
          first = false;
        }
      }
    }
  }

  private table(table: Table): void {
    if (table.columns.length === 0) return;
    const totals = this.options.engine?.view(table).totals ?? [];
    const width = Math.floor(9000 / table.columns.length);
    const right = (c: number) => ["number", "money", "percent"].includes(table.columns[c]?.property.type ?? "text");
    const cell = (text: string, c: number, props = "") =>
      `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${right(c) ? '<w:jc w:val="right"/>' : ""}</w:pPr><w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p></w:tc>`;
    const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${table.columns.map((column, c) => cell(column.name, c, "<w:b/>")).join("")}</w:tr>`;
    const rows = table.rows.map((cells) => `<w:tr>${table.columns.map((_, c) => cell(cells[c]?.display ?? "", c)).join("")}</w:tr>`).join("");
    const total = totals.some(Boolean)
      ? `<w:tr>${table.columns.map((_, c) => cell(totals[c]?.display ?? (c === 0 ? "Total" : ""), c, "<w:b/>")).join("")}</w:tr>`
      : "";
    this.body.push(
      `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${table.columns.map(() => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${header}${rows}${total}</w:tbl>`,
    );
    this.paragraph("");
  }

  private image(node: DocxNode): void {
    const src = str(node.attrs?.src);
    const found = fromDataUrl(src);
    const alt = str(node.attrs?.alt) || str(node.attrs?.title);
    if (!found) {
      if (src) this.paragraph(this.textRun({ type: "text", text: alt || src, marks: [{ type: "link", attrs: { href: src } }] }, ""));
      return;
    }
    const size = imageSize(found.bytes, found.kind) ?? { width: 800, height: 600 };
    let cx = size.width * EMU_PER_PX;
    let cy = size.height * EMU_PER_PX;
    if (cx > MAX_IMAGE_EMU) {
      cy = Math.round((cy * MAX_IMAGE_EMU) / cx);
      cx = MAX_IMAGE_EMU;
    }
    const name = `image${this.media.length + 1}.${found.kind === "png" ? "png" : "jpeg"}`;
    this.media.push({ path: `word/media/${name}`, data: found.bytes });
    const id = this.rel("http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", `media/${name}`);
    const n = this.media.length;
    this.paragraph(
      `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="${name}" descr="${escape(alt)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`,
      '<w:jc w:val="center"/>',
    );
  }

  contents(): string {
    const title = this.options.lang === "en" ? "Contents" : "Sommaire";
    const entries = this.headings
      .filter((h) => h.level <= 3)
      .map((h) => `<w:p><w:pPr><w:pStyle w:val="TOC${h.level}"/></w:pPr><w:r><w:t xml:space="preserve">${escape(h.text)}</w:t></w:r></w:p>`)
      .join("");
    return (
      `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>${title}</w:t></w:r></w:p>` +
      `<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r></w:p>` +
      entries +
      `<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`
    );
  }
}

function headingStyle(level: number, size: number, before: number): string {
  return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="141418"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>
${headingStyle(1, 32, 360)}${headingStyle(2, 26, 280)}${headingStyle(3, 24, 240)}${headingStyle(4, 22, 200)}${headingStyle(5, 22, 160)}${headingStyle(6, 22, 160)}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/><w:color w:val="3A3A42"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Callout"><w:name w:val="Callout"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="D64A33"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F4F2EE"/><w:ind w:left="200" w:right="200"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F1F1EF"/><w:spacing w:after="160" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1F5FBF"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:next w:val="Normal"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="220"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC3"><w:name w:val="toc 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="440"/></w:pPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/></w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

function numbering(nums: { abstract: number; start: number }[]): string {
  const level = (ilvl: number, ordered: boolean) =>
    `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? (ilvl % 3 === 1 ? "lowerLetter" : ilvl % 3 === 2 ? "lowerRoman" : "decimal") : "bullet"}"/><w:lvlText w:val="${ordered ? `%${ilvl + 1}.` : BULLETS[ilvl % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${(ilvl + 1) * LIST_INDENT * 2}" w:hanging="${LIST_INDENT}"/></w:pPr></w:lvl>`;
  const abstract = (id: number, ordered: boolean) =>
    `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => level(i, ordered)).join("")}</w:abstractNum>`;
  const instances = nums
    .map((num, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${num.abstract}"/>${num.abstract === 2 ? `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${num.start}"/></w:lvlOverride>` : ""}</w:num>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}>${abstract(1, false)}${abstract(2, true)}${instances}</w:numbering>`;
}

/**
 * A kertas document as a Word file (.docx): headings keep Word's Heading
 * styles so the navigation pane and the contents work, lists are Word lists,
 * tables keep their header and totals, links and footnotes stay live, and
 * images pasted into the note are embedded. Built without any library, so it
 * runs the same in the browser, on the phone and on a server.
 */
export function toDocx(document: DocxNode, options: DocxOptions = {}): Uint8Array<ArrayBuffer> {
  const writer = new Writer(options);
  if (options.title?.trim()) writer.paragraph(`<w:r><w:t xml:space="preserve">${escape(options.title.trim())}</w:t></w:r>`, '<w:pStyle w:val="Title"/>');
  writer.blocks(document.content ?? []);
  const body = writer.body.map((part) => (part === "\u0000TOC\u0000" ? writer.contents() : part)).join("");
  const lang = options.lang === "en" ? "en-GB" : "fr-FR";

  const footnotes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${writer.footnotes
    .map(
      (text, i) =>
        `<w:footnote w:id="${i + 1}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${escape(text)}</w:t></w:r></w:p></w:footnote>`,
    )
    .join("")}</w:footnotes>`;

  const document_ = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W} ${DRAWING}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const fixedRels = [
    ["rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", "styles.xml"],
    ["rId2", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering", "numbering.xml"],
    ["rId3", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes", "footnotes.xml"],
    ["rId4", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings", "settings.xml"],
  ];
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${fixedRels
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`)
    .join("")}${writer.rels
    .map((rel) => `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${escape(rel.target)}"${rel.external ? ' TargetMode="External"' : ""}/>`)
    .join("")}</Relationships>`;

  const hasContents = body.includes(" TOC ");
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${W}>${hasContents ? '<w:updateFields w:val="true"/>' : ""}<w:defaultTabStop w:val="708"/><w:themeFontLang w:val="${lang}"/></w:settings>`;

  const title = escape(options.title?.trim() ?? "");
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${title}</dc:title><dc:creator>Kaiin</dc:creator><dc:language>${lang}</dc:language></cp:coreProperties>`;

  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

  const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

  return zip([
    { path: "[Content_Types].xml", data: types },
    { path: "_rels/.rels", data: packageRels },
    { path: "docProps/core.xml", data: core },
    { path: "word/document.xml", data: document_ },
    { path: "word/styles.xml", data: STYLES.replace('w:val="fr-FR"', `w:val="${lang}"`) },
    { path: "word/numbering.xml", data: numbering(writer.nums) },
    { path: "word/footnotes.xml", data: footnotes },
    { path: "word/settings.xml", data: settings },
    { path: "word/_rels/document.xml.rels", data: rels },
    ...writer.media,
  ]);
}
