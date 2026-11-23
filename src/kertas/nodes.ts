import type { Mark as PMMark, Node as PMNode, Schema } from "@tiptap/pm/model";

import type { DocBlock, Inline, Mark } from "./types";

const MARK_NAMES: Record<Mark["type"], string> = {
  bold: "bold",
  italic: "italic",
  code: "code",
  strike: "strike",
  link: "link",
};

function marksOf(schema: Schema, marks: Mark[] = []): PMMark[] {
  return marks.flatMap((mark) => {
    const type = schema.marks[MARK_NAMES[mark.type]];
    if (!type) return [];
    return [type.create(mark.type === "link" ? { href: mark.href } : null)];
  });
}

function inlineNodes(schema: Schema, content: Inline[]): PMNode[] {
  const hardBreak = schema.nodes.hardBreak;
  return content.flatMap((inline) =>
    inline.text.split("\n").flatMap((part, index) => {
      const pieces: PMNode[] = [];
      if (index > 0 && hardBreak) pieces.push(hardBreak.create());
      if (part) pieces.push(schema.text(part, marksOf(schema, inline.marks)));
      return pieces;
    }),
  );
}

function blockNode(schema: Schema, block: DocBlock): PMNode | null {
  const { nodes } = schema;
  switch (block.kind) {
    case "paragraph":
      return nodes.paragraph?.create(null, inlineNodes(schema, block.content)) ?? null;
    case "heading":
      return nodes.heading?.create({ level: Math.min(block.level, 6) }, inlineNodes(schema, block.content)) ?? null;
    case "code":
      return nodes.codeBlock?.create({ language: block.language }, block.text ? schema.text(block.text) : null) ?? null;
    case "rule":
      return nodes.horizontalRule?.create() ?? null;
    case "quote": {
      const children = blockNodes(schema, block.blocks);
      return children.length ? (nodes.blockquote?.create(null, children) ?? null) : null;
    }
    case "table":
      return nodes.collection?.create({ table: block.table }) ?? null;
    case "list": {
      const list = nodes[block.ordered ? "orderedList" : "bulletList"];
      const item = nodes.listItem;
      if (!list || !item) return null;
      const items = block.items.map((blocks) => {
        const children = blockNodes(schema, blocks);
        const first = children[0];
        const content = first?.type === nodes.paragraph ? children : [nodes.paragraph.create(), ...children];
        return item.create(null, content);
      });
      return list.create(block.ordered ? { start: block.start } : null, items);
    }
  }
}

export function blockNodes(schema: Schema, blocks: DocBlock[]): PMNode[] {
  return blocks.map((block) => blockNode(schema, block)).filter((node): node is PMNode => node !== null);
}

export function isPlainParagraph(blocks: DocBlock[]): boolean {
  return blocks.length === 1 && blocks[0].kind === "paragraph" && blocks[0].content.every((inline) => !inline.marks?.length);
}

export function answerParagraph(schema: Schema, answer: string): PMNode | null {
  const paragraph = schema.nodes.paragraph;
  if (!paragraph) return null;
  const colon = answer.indexOf(":");
  const bold = schema.marks.bold;
  if (colon <= 0 || !bold) return paragraph.create(null, schema.text(answer));
  const label = answer.slice(0, colon + 1);
  const rest = answer.slice(colon + 1);
  return paragraph.create(null, [schema.text(label, [bold.create()]), ...(rest ? [schema.text(rest)] : [])]);
}
