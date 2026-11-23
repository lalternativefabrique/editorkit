import type { SlashItem } from "../index";
import { describe, expect, it } from "vitest";

import { sectionSlashItems } from "./slashSections";

const item = (id: string): SlashItem => ({ id, title: id, command: () => {} });

describe("slash sections", () => {
  it("orders items by section, names them, and keeps unknown ones last", () => {
    const result = sectionSlashItems([item("align-left"), item("custom"), item("tasks"), item("heading1")]);
    expect(result.map((entry) => [entry.id, entry.group])).toEqual([
      ["heading1", "Texte"],
      ["tasks", "Listes"],
      ["align-left", "Mise en page"],
      ["custom", undefined],
    ]);
  });
});
