import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SlashMenu } from "./SlashMenu";
import type { SlashItem } from "./slash";

const item = (id: string, group?: string): SlashItem => ({
  id,
  title: id,
  group,
  command: () => {},
});
const items = [item("h1", "Texte"), item("h2", "Texte"), item("image", "Insérer"), item("loose")];
const headers = (html: string) =>
  [...html.matchAll(/lalt-slash__group[^>]*>([^<]+)</g)].map((m) => m[1]);

describe("slash menu sections", () => {
  it("names each group once, above its first item", () => {
    expect(headers(renderToStaticMarkup(<SlashMenu items={items} command={() => {}} />))).toEqual([
      "Texte",
      "Insérer",
    ]);
  });

  it("lists matches flat while a query is typed", () => {
    expect(
      headers(renderToStaticMarkup(<SlashMenu items={items} command={() => {}} query="h" />)),
    ).toEqual([]);
  });
});
