import { unzipSync } from "fflate";

export interface ImportedImage {
  placeholder: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface ImportedDocx {
  title: string;
  markdown: string;
  images: ImportedImage[];
}

interface El {
  name: string;
  attrs: Record<string, string>;
  children: (El | string)[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) =>
    code[0] === "#" ? String.fromCodePoint(code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)) : (ENTITIES[code] ?? whole),
  );

function parseXml(xml: string): El {
  const root: El = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  const tag = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][\s\S]*?>/g;
  let last = 0;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    const top = stack[stack.length - 1];
    if (m.index > last) top.children.push(decode(xml.slice(last, m.index)));
    last = tag.lastIndex;
    if (m[5] !== undefined) {
      top.children.push(m[5]);
      continue;
    }
    if (!m[2]) continue;
    if (m[1]) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3] ?? "");
    const el: El = { name: m[2], attrs, children: [] };
    top.children.push(el);
    if (!m[4]) stack.push(el);
  }
  return root;
}

const els = (el: El | undefined) => (el?.children.filter((c): c is El => typeof c !== "string") ?? []);
const child = (el: El | undefined, name: string) => els(el).find((c) => c.name === name);
const find = (el: El | undefined, name: string): El | undefined => {
  for (const c of els(el)) {
    if (c.name === name) return c;
    const deep = find(c, name);
    if (deep) return deep;
  }
  return undefined;
};
const val = (el: El | undefined) => el?.attrs["w:val"];
const on = (el: El | undefined) => !!el && !["0", "false", "none"].includes(el.attrs["w:val"] ?? "true");

interface Style {
  name: string;
  level?: number;
  basedOn?: string;
  numId?: string;
  ilvl?: number;
}

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  highlight?: boolean;
  code?: boolean;
  href?: string;
}

const MD_SPECIAL = /([\\`*_[\]<>|=~])/g;
const escapeText = (text: string) => text.replace(MD_SPECIAL, "\\$1");
const escapeLineStart = (line: string) => line.replace(/^(\s*)(#{1,6}\s|>|[-+*]\s|\d+[.)]\s)/, "$1\\$2");

function joinRuns(runs: Run[]): string {
  const merged: Run[] = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.bold === run.bold && prev.italic === run.italic && prev.strike === run.strike && prev.highlight === run.highlight && prev.code === run.code && prev.href === run.href) prev.text += run.text;
    else merged.push({ ...run });
  }
  return merged
    .map((run) => {
      if (run.text === "\n") return "  \n";
      if (!run.text.trim()) return run.text.replace(/\n/g, "  \n");
      const lead = run.text.match(/^\s*/)?.[0] ?? "";
      const tail = run.text.match(/\s*$/)?.[0] ?? "";
      let out = run.code ? `\`${run.text.trim().replace(/`/g, "'")}\`` : escapeText(run.text.trim()).replace(/\n/g, "  \n");
      if (!run.code) {
        if (run.highlight) out = `==${out}==`;
        if (run.strike) out = `~~${out}~~`;
        if (run.italic) out = `*${out}*`;
        if (run.bold) out = `**${out}**`;
      }
      if (run.href) out = `[${out}](${run.href.replace(/[()\s]/g, encodeURIComponent)})`;
      return lead + out + tail;
    })
    .join("");
}

const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml" };

export function fromDocx(bytes: Uint8Array): ImportedDocx {
  const files = unzipSync(bytes);
  const text = (path: string) => (files[path] ? new TextDecoder().decode(files[path]) : "");
  const body = find(parseXml(text("word/document.xml")), "w:body");
  if (!body) throw new Error("not a Word document");

  const rels = new Map<string, { target: string; external: boolean }>();
  for (const rel of els(find(parseXml(text("word/_rels/document.xml.rels")), "Relationships"))) rels.set(rel.attrs.Id, { target: rel.attrs.Target, external: rel.attrs.TargetMode === "External" });

  const styles = new Map<string, Style>();
  for (const s of els(find(parseXml(text("word/styles.xml")), "w:styles")).filter((s) => s.name === "w:style")) {
    const pPr = child(s, "w:pPr");
    const numPr = child(pPr, "w:numPr");
    const outline = val(child(pPr, "w:outlineLvl"));
    styles.set(s.attrs["w:styleId"], {
      name: (val(child(s, "w:name")) ?? "").toLowerCase(),
      level: outline !== undefined ? Number(outline) + 1 : undefined,
      basedOn: val(child(s, "w:basedOn")),
      numId: val(child(numPr, "w:numId")),
      ilvl: val(child(numPr, "w:ilvl")) !== undefined ? Number(val(child(numPr, "w:ilvl"))) : undefined,
    });
  }
  const styleOf = (id: string | undefined, depth = 0): Style | undefined => {
    const s = id ? styles.get(id) : undefined;
    if (!s || depth > 8) return s;
    const base = styleOf(s.basedOn, depth + 1);
    return { ...s, level: s.level ?? base?.level, numId: s.numId ?? base?.numId };
  };

  const numbering = parseXml(text("word/numbering.xml"));
  const abstracts = new Map<string, El>();
  for (const a of els(find(numbering, "w:numbering")).filter((n) => n.name === "w:abstractNum")) abstracts.set(a.attrs["w:abstractNumId"], a);
  const nums = new Map<string, El | undefined>();
  for (const n of els(find(numbering, "w:numbering")).filter((n) => n.name === "w:num")) nums.set(n.attrs["w:numId"], abstracts.get(val(child(n, "w:abstractNumId")) ?? ""));
  const ordered = (numId: string, ilvl: number) => {
    const lvl = els(nums.get(numId)).find((l) => l.name === "w:lvl" && l.attrs["w:ilvl"] === String(ilvl));
    const fmt = val(child(lvl, "w:numFmt")) ?? "bullet";
    return fmt !== "bullet" && fmt !== "none";
  };

  const images: ImportedImage[] = [];
  const imageFor = (rId: string, alt: string) => {
    const rel = rels.get(rId);
    if (!rel || rel.external) return "";
    const path = rel.target.startsWith("/") ? rel.target.slice(1) : `word/${rel.target.replace(/^\.\//, "")}`;
    const data = files[path];
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    if (!data || !IMAGE_MIME[ext]) return "";
    const placeholder = `docx-image:${images.length + 1}`;
    images.push({ placeholder, name: path.split("/").pop() ?? `image.${ext}`, mime: IMAGE_MIME[ext], bytes: data });
    return `![${escapeText(alt.replace(/\s+/g, " ").trim())}](${placeholder})`;
  };

  const runsOf = (p: El): { runs: Run[]; inlineImages: string[] } => {
    const runs: Run[] = [];
    const inlineImages: string[] = [];
    let field: { instr: string; href?: string; showing: boolean } | null = null;
    const walk = (el: El, href?: string) => {
      for (const c of els(el)) {
        if (c.name === "w:hyperlink") {
          const rel = c.attrs["r:id"] ? rels.get(c.attrs["r:id"]) : undefined;
          walk(c, rel?.target ?? href);
        } else if (c.name === "w:fldSimple") {
          const m = c.attrs["w:instr"]?.match(/HYPERLINK\s+"([^"]+)"/);
          walk(c, m?.[1] ?? href);
        } else if (c.name === "w:ins" || c.name === "w:smartTag" || c.name === "w:sdt" || c.name === "w:sdtContent" || c.name === "w:customXml") {
          walk(c, href);
        } else if (c.name === "w:r") {
          const rPr = child(c, "w:rPr");
          const fonts = child(rPr, "w:rFonts")?.attrs["w:ascii"] ?? "";
          const look = {
            bold: on(child(rPr, "w:b")),
            italic: on(child(rPr, "w:i")),
            strike: on(child(rPr, "w:strike")) || on(child(rPr, "w:dstrike")),
            highlight: !!child(rPr, "w:highlight") && val(child(rPr, "w:highlight")) !== "none",
            code: /consolas|courier|mono/i.test(fonts),
          };
          for (const part of els(c)) {
            if (part.name === "w:fldChar") {
              const kind = part.attrs["w:fldCharType"];
              if (kind === "begin") field = { instr: "", showing: false };
              else if (kind === "separate" && field) {
                field.href = field.instr.match(/HYPERLINK\s+"([^"]+)"/)?.[1];
                field.showing = true;
              } else if (kind === "end") field = null;
            } else if (part.name === "w:instrText") {
              if (field && !field.showing) field.instr += part.children.join("");
            } else if (field && !field.showing) {
              continue;
            } else if (part.name === "w:t") {
              runs.push({ text: part.children.filter((t) => typeof t === "string").join(""), ...look, href: field?.href ?? href });
            } else if (part.name === "w:tab") {
              runs.push({ text: " ", ...look, href });
            } else if (part.name === "w:br" || part.name === "w:cr") {
              if (part.attrs["w:type"] !== "page" && part.attrs["w:type"] !== "column") runs.push({ text: "\n" });
            } else if (part.name === "w:noBreakHyphen") {
              runs.push({ text: "-", ...look, href });
            } else if (part.name === "w:drawing" || part.name === "w:pict") {
              const blip = find(part, "a:blip") ?? find(part, "v:imagedata");
              const rId = blip?.attrs["r:embed"] ?? blip?.attrs["r:id"];
              const alt = find(part, "wp:docPr")?.attrs.descr ?? "";
              const md = rId ? imageFor(rId, alt) : "";
              if (md) inlineImages.push(md);
            }
          }
        }
      }
    };
    walk(p);
    return { runs, inlineImages };
  };

  let title = "";
  const out: string[] = [];
  const listCounters = new Map<string, number>();

  const paragraph = (p: El, inTable = false): { kind: "list"; line: string; list: string } | { kind: "block"; text: string } | null => {
    const pPr = child(p, "w:pPr");
    const style = styleOf(val(child(pPr, "w:pStyle")));
    const { runs, inlineImages } = runsOf(p);
    const content = joinRuns(runs).replace(/^\s+|\s+$/g, "").replace(/[ \t]*\n[ \t]*/g, "  \n");
    const plain = runs.map((r) => r.text).join("").trim();
    const name = style?.name ?? "";
    const level = /^heading (\d)/.exec(name)?.[1] ? Number(/^heading (\d)/.exec(name)?.[1]) : (val(child(pPr, "w:outlineLvl")) !== undefined ? Number(val(child(pPr, "w:outlineLvl"))) + 1 : style?.level);
    const images = inlineImages.join("\n\n");
    if (inTable) return { kind: "block", text: [content, ...inlineImages].filter(Boolean).join(" ") };
    if (name === "title" || name === "titre") {
      if (!title && plain) {
        title = plain;
        return images ? { kind: "block", text: images } : null;
      }
      return { kind: "block", text: `# ${content}` };
    }
    const numPr = child(pPr, "w:numPr");
    const numId = val(child(numPr, "w:numId")) ?? style?.numId;
    const ilvl = Number(val(child(numPr, "w:ilvl")) ?? style?.ilvl ?? 0);
    if (numId && numId !== "0" && plain) {
      const key = `${numId}:${ilvl}`;
      const isOrdered = ordered(numId, ilvl);
      const n = (listCounters.get(key) ?? 0) + 1;
      listCounters.set(key, n);
      for (const k of [...listCounters.keys()]) if (k.startsWith(`${numId}:`) && Number(k.split(":")[1]) > ilvl) listCounters.delete(k);
      return { kind: "list", list: numId, line: `${"   ".repeat(Math.min(ilvl, 6))}${isOrdered ? `${n}.` : "-"} ${content}` };
    }
    if (level && level >= 1 && level <= 6 && plain) return { kind: "block", text: `${"#".repeat(level)} ${runs.map((r) => escapeText(r.text)).join("").trim()}${images ? `\n\n${images}` : ""}` };
    if (/quote|citation/.test(name) && plain) return { kind: "block", text: `> ${content.replace(/\n/g, "\n> ")}` };
    if (!plain) return images ? { kind: "block", text: images } : null;
    return { kind: "block", text: `${escapeLineStart(content)}${images ? `\n\n${images}` : ""}` };
  };

  const table = (tbl: El): string => {
    const rows = els(tbl)
      .filter((r) => r.name === "w:tr")
      .map((tr) =>
        els(tr)
          .filter((c) => c.name === "w:tc" || c.name === "w:sdt")
          .flatMap((tc) => {
            const cell = tc.name === "w:sdt" ? (find(tc, "w:tc") ?? tc) : tc;
            const span = Number(val(child(child(cell, "w:tcPr"), "w:gridSpan")) ?? 1);
            const text = els(cell)
              .filter((p) => p.name === "w:p")
              .map((p) => paragraph(p, true))
              .map((b) => (b && b.kind === "block" ? b.text : ""))
              .filter(Boolean)
              .join(" ")
              .replace(/\|/g, "\\|")
              .replace(/ {2}\n/g, " ")
              .trim();
            return [text, ...Array.from({ length: Math.max(0, span - 1) }, () => "")];
          }),
      )
      .filter((r) => r.length);
    if (!rows.length) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] || " ").join(" | ")} |`;
    return [line(rows[0]), `|${" --- |".repeat(width)}`, ...rows.slice(1).map(line)].join("\n");
  };

  let list: string[] = [];
  let listId = "";
  const flush = () => {
    if (list.length) out.push(list.join("\n"));
    list = [];
    listId = "";
  };
  const blocks = (container: El) => {
    for (const el of els(container)) {
      if (el.name === "w:p") {
        const b = paragraph(el);
        if (!b) {
          flush();
          continue;
        }
        if (b.kind === "list") {
          if (listId && listId !== b.list) flush();
          listId = b.list;
          list.push(b.line);
        }
        else {
          flush();
          out.push(b.text);
        }
      } else if (el.name === "w:tbl") {
        flush();
        const t = table(el);
        if (t) out.push(t);
      } else if (el.name === "w:sdt" || el.name === "w:sdtContent" || el.name === "w:customXml" || el.name === "w:ins") {
        blocks(el.name === "w:sdt" ? (child(el, "w:sdtContent") ?? el) : el);
      }
    }
  };
  blocks(body);
  flush();

  if (!title) {
    const core = parseXml(text("docProps/core.xml"));
    title = (find(core, "dc:title")?.children.filter((c) => typeof c === "string").join("") ?? "").trim();
  }
  if (!title) {
    const first = out[0]?.match(/^# (.+)$/);
    if (first) {
      title = first[1].replace(/\\(.)/g, "$1");
      out.shift();
    }
  }
  return { title, markdown: out.join("\n\n").trim(), images };
}

export function withStoredImages(markdown: string, stored: Map<string, string>): string {
  return markdown.replace(/!\[([^\]]*)\]\((docx-image:\d+)\)/g, (_, alt: string, placeholder: string) => {
    const src = stored.get(placeholder);
    return src ? `![${alt}](${src})` : "";
  }).replace(/\n{3,}/g, "\n\n").trim();
}
