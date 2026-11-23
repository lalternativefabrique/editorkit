import { describe, expect, it } from "vitest";

import { pasteGrid } from "./tableOps";
import type { Table } from "./types";

const cell = (raw: string) => ({ raw, display: raw });

describe("pasteGrid", () => {
  const table: Table = {
    columns: [
      { name: "Mois", property: { type: "text" } },
      { name: "Montant", property: { type: "text" } },
    ],
    rows: [[cell("janvier"), cell("")]],
  };

  it("fills from the chosen cell and grows the table", () => {
    const next = pasteGrid(table, "900 €\n1 500 €\t20 %\n", 0, 1);
    expect(next.columns.map((c) => c.name)).toEqual(["Mois", "Montant", "Colonne 3"]);
    expect(next.rows.map((row) => row.map((v) => v.raw))).toEqual([
      ["janvier", "900 €", ""],
      ["", "1 500 €", "20 %"],
    ]);
  });
});
