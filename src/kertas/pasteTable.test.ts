// @vitest-environment happy-dom
import { getSchema } from "@tiptap/core";
import { DOMParser } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { Collection, tableFromElement } from "./Collection";
import { kertasFrom, type Kertas } from "./engine";

async function engineOrSkip(context: { skip: () => void }): Promise<Kertas | null> {
  const wasm = resolve(process.cwd(), "kertas/dist/kertas.wasm");
  if (!existsSync(wasm)) {
    context.skip();
    return null;
  }
  return kertasFrom((await WebAssembly.instantiate(readFileSync(wasm), {})).instance, () => new Date(2026, 10, 14));
}

const html = (markup: string) => {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host;
};

describe("pasting an HTML table", () => {
  it("becomes a typed kertas table, even when the clipboard's plain text has no tabs", async (context) => {
    const engine = await engineOrSkip(context);
    if (!engine) return;
    const schema = getSchema([StarterKit.configure({ codeBlock: false }), Collection.configure({ engine })]);
    const doc = DOMParser.fromSchema(schema).parse(
      html(`<p>Budget</p><table><tr><th>Poste</th><th>Montant</th></tr><tr><td>Design</td><td>1 200 €</td></tr><tr><td>Travaux</td><td>18 000 €</td></tr></table>`),
    );
    const types = doc.content.content.map((n) => n.type.name);
    expect(types).toEqual(["paragraph", "collection"]);
    const table = doc.content.content[1].attrs.table;
    expect(table.columns.map((c: { name: string }) => c.name)).toEqual(["Poste", "Montant"]);
    expect(table.rows).toHaveLength(2);
    expect(table.columns[1].property.type).toBe("money");
  });

  it("leaves mail layout tables and one-row tables alone", async (context) => {
    const engine = await engineOrSkip(context);
    if (!engine) return;
    const layout = html(`<table role="presentation"><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>`).firstElementChild as HTMLElement;
    const nested = html(`<table><tr><td><table><tr><td>x</td></tr></table></td><td>y</td></tr><tr><td>1</td><td>2</td></tr></table>`).firstElementChild as HTMLElement;
    const single = html(`<table><tr><td>seul</td><td>rang</td></tr></table>`).firstElementChild as HTMLElement;
    expect(tableFromElement(layout, engine)).toBeNull();
    expect(tableFromElement(nested, engine)).toBeNull();
    expect(tableFromElement(single, engine)).toBeNull();
    expect(tableFromElement(single, null)).toBeNull();
  });
});
