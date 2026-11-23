import type { SlashItem } from "../index";

export interface SlashSection {
  name: string;
  ids: string[];
}

export const defaultSlashSections: SlashSection[] = [
  { name: "Texte", ids: ["heading1", "heading2", "blockquote", "codeBlock", "callout", "toggle"] },
  { name: "Listes", ids: ["bulletList", "orderedList", "tasks"] },
  {
    name: "Insérer",
    ids: ["page-sub", "image", "pdf", "link-preview", "kertas-table", "kertas-chart", "formula", "inline-formula", "footnote", "contents"],
  },
  { name: "Calculer sur le tableau", ids: ["kertas-sum", "kertas-mean", "kertas-median", "kertas-max", "kertas-min", "kertas-count"] },
  {
    name: "Mise en page",
    ids: ["horizontalRule", "columns-2", "columns-3", "align-left", "align-center", "align-right", "align-justify"],
  },
  { name: "Corriger", ids: ["kertas-tidy"] },
];

/** Orders items section by section and names each one's section; items no section lists keep their order, last. */
export function sectionSlashItems(items: SlashItem[], sections: SlashSection[] = defaultSlashSections): SlashItem[] {
  const placed = new Set<string>();
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = sections.flatMap((section) =>
    section.ids.flatMap((id) => {
      const item = byId.get(id);
      if (!item || placed.has(id)) return [];
      placed.add(id);
      return [{ ...item, group: section.name }];
    }),
  );
  return [...ordered, ...items.filter((item) => !placed.has(item.id))];
}
