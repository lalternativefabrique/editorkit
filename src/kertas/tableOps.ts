import type { Kertas } from "./engine";
import type { Lang, PropertyType, Table, Value } from "./types";

const DEFAULT_NAME = /^(Colonne|Column) \d+$/;

const TYPE_NAMES: Record<Lang, Record<PropertyType["type"], string>> = {
  fr: { text: "Texte", number: "Nombre", money: "Montant", percent: "Pourcentage", date: "Date", checkbox: "Fait" },
  en: { text: "Text", number: "Number", money: "Amount", percent: "Percent", date: "Date", checkbox: "Done" },
};

export const EMPTY_VALUE: Value = { raw: "", display: "" };

export function withCell(table: Table, row: number, column: number, value: Value): Table {
  return { ...table, rows: table.rows.map((cells, r) => (r === row ? cells.map((cell, c) => (c === column ? value : cell)) : cells)) };
}

export function retyped(engine: Kertas, table: Table, column: number, property: PropertyType): Table {
  const values = engine.typeValues(table.rows.map((cells) => cells[column]?.raw ?? ""), property);
  return {
    columns: table.columns.map((col, c) => (c === column ? { ...col, property } : col)),
    rows: table.rows.map((cells, r) => cells.map((cell, c) => (c === column ? values[r] : cell))),
  };
}

export function emptyRow(table: Table): Value[] {
  return table.columns.map(() => EMPTY_VALUE);
}

export function autoType(engine: Kertas, table: Table): Table {
  return table.columns.reduce((current, column, c) => {
    if (column.manual || column.formula !== undefined || column.property.type !== "text") return current;
    const raws = current.rows.map((cells) => cells[c]?.raw ?? "").filter((raw) => raw.trim() !== "");
    if (raws.length === 0) return current;
    const property = engine.infer(raws);
    if (property.type === "text") return current;
    const next = retyped(engine, current, c, property);
    if (!DEFAULT_NAME.test(column.name)) return next;
    const name = TYPE_NAMES[engine.language][property.type];
    return { ...next, columns: next.columns.map((col, i) => (i === c ? { ...col, name } : col)) };
  }, table);
}

export function pasteGrid(table: Table, text: string, row: number, column: number): Table {
  const lines = text.replace(/\r/g, "").split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  const grid = lines.map((line) => line.split("\t"));
  const width = Math.max(table.columns.length, column + Math.max(...grid.map((cells) => cells.length)));
  const height = Math.max(table.rows.length, row + grid.length);
  const columns = [
    ...table.columns,
    ...Array.from({ length: width - table.columns.length }, (_, i) => ({
      name: `Colonne ${table.columns.length + i + 1}`,
      property: { type: "text" } as PropertyType,
    })),
  ];
  const rows = Array.from({ length: height }, (_, r) =>
    Array.from({ length: width }, (_, c) => {
      const pasted = grid[r - row]?.[c - column];
      if (pasted !== undefined) return { raw: pasted.trim(), display: pasted.trim() };
      return table.rows[r]?.[c] ?? EMPTY_VALUE;
    }),
  );
  return { columns, rows };
}

export function retypeAll(engine: Kertas, table: Table): Table {
  return table.columns.reduce(
    (current, column, c) => (column.property.type === "text" ? current : retyped(engine, current, c, column.property)),
    table,
  );
}

const isEmptyRow = (cells: Value[]) => cells.every((cell) => cell.raw.trim() === "");

export function withoutEmptyTail(table: Table): Table {
  let end = table.rows.length;
  while (end > 0 && isEmptyRow(table.rows[end - 1])) end--;
  return end === table.rows.length ? table : { ...table, rows: table.rows.slice(0, end) };
}
