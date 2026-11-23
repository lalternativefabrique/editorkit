import { describe, expect, it } from "vitest";

import { addDays, daysBetween, groupColumn, lanes, moveCard, rawDate, timeline, timelineColumns, withStatusColumn } from "./layouts";
import type { Table, Value } from "./types";

const text = (raw: string): Value => ({ raw, display: raw });
const date = (iso: string): Value => ({ raw: rawDate(iso), display: rawDate(iso), typed: { type: "date", iso } });

const tasks: Table = {
  columns: [
    { name: "Tâche", property: { type: "text" } },
    { name: "Responsable", property: { type: "text" } },
    { name: "Statut", property: { type: "text" } },
  ],
  rows: [
    [text("Devis"), text("Léa"), text("Fait")],
    [text("Commande"), text("Marc"), text("En cours")],
    [text("Livraison"), text("Léa"), text("")],
    [text("Facture"), text("Marc"), text("En cours")],
  ],
};

const titles = (table: Table) => table.rows.map((cells) => `${cells[0].raw}:${cells[2].raw}`);

describe("board", () => {
  it("groups by the column named like a status, before any other short column", () => {
    expect(groupColumn(tasks, { kind: "board" })).toBe(2);
  });

  it("keeps declared lanes first, then values in reading order, then cards without a value", () => {
    const result = lanes(tasks, 2, ["À faire", "En cours", "Fait"]);
    expect(result.map((lane) => [lane.value, lane.rows])).toEqual([
      ["À faire", []],
      ["En cours", [1, 3]],
      ["Fait", [0]],
      ["", [2]],
    ]);
  });

  it("moves a card to another lane, before the card it was dropped on", () => {
    const moved = moveCard(tasks, 2, 0, "En cours", 1, text);
    expect(titles(moved)).toEqual(["Commande:En cours", "Devis:En cours", "Livraison:", "Facture:En cours"]);
  });

  it("reorders inside a lane without touching the other rows", () => {
    const moved = moveCard(tasks, 2, 3, "En cours", 0, text);
    expect(titles(moved)).toEqual(["Devis:Fait", "Facture:En cours", "Commande:En cours", "Livraison:"]);
  });

  it("keeps the row in place when it lands alone in a lane", () => {
    const moved = moveCard(tasks, 2, 1, "À faire", 0, text);
    expect(titles(moved)).toEqual(["Devis:Fait", "Commande:À faire", "Livraison:", "Facture:En cours"]);
  });

  it("returns the same table when the card does not move", () => {
    expect(moveCard(tasks, 2, 1, "En cours", 0, text)).toBe(tasks);
  });

  it("adds a status column with every card to do", () => {
    const plain: Table = { columns: [tasks.columns[0]], rows: [[text("Devis")], [text("Commande")]] };
    const made = withStatusColumn(plain);
    expect(made.group).toBe(1);
    expect(made.table.rows.map((cells) => cells[1].raw)).toEqual(["À faire", "À faire"]);
  });
});

describe("timeline", () => {
  const plan: Table = {
    columns: [
      { name: "Étape", property: { type: "text" } },
      { name: "Début", property: { type: "date" } },
      { name: "Fin", property: { type: "date" } },
    ],
    rows: [
      [text("Cadrage"), date("2026-11-16"), date("2026-11-20")],
      [text("Maquettes"), date("2026-11-23"), date("2026-11-18")],
      [text("Recette"), { raw: "", display: "" }, { raw: "", display: "" }],
    ],
  };

  it("counts days across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(daysBetween("2026-11-28", "2026-12-02")).toBe(4);
  });

  it("takes the first two date columns as start and end", () => {
    expect(timelineColumns(plan, { kind: "timeline" })).toEqual({ start: 1, end: 2 });
  });

  it("draws a bar per dated row, a single day when the end is before the start, and none without a start", () => {
    const result = timeline(plan, 1, 2, "2026-11-12");
    expect(result.bars).toEqual([
      { row: 0, from: "2026-11-16", to: "2026-11-20" },
      { row: 1, from: "2026-11-23", to: "2026-11-23" },
      null,
    ]);
    expect(result.from).toBe("2026-11-14");
    expect(result.days).toBeGreaterThanOrEqual(21);
  });

  it("writes dates the way they are typed", () => {
    expect(rawDate("2026-11-03")).toBe("03/11/2026");
  });
});
