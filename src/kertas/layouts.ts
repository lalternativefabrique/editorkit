import type { Table, TableLayout, Value } from "./types";

export const DEFAULT_LAYOUT: TableLayout = { kind: "table" };
export const DEFAULT_LANES = ["À faire", "En cours", "Fait"];
export const STATUS_NAME = "Statut";

const MAX_LANES = 8;
const STATUS_HINT = /statut|status|état|etat|étape|etape|phase|avancement|stage/i;
const DONE: RegExp = /^(fait|terminée?s?|done|fini|livrée?s?|clos|closed)$/i;

const textAt = (table: Table, row: number, column: number) => table.rows[row]?.[column]?.raw.trim() ?? "";

function distinct(table: Table, column: number): string[] {
  const seen: string[] = [];
  for (let r = 0; r < table.rows.length; r++) {
    const value = textAt(table, r, column);
    if (value && !seen.includes(value)) seen.push(value);
  }
  return seen;
}

export function groupCandidates(table: Table): number[] {
  return table.columns
    .map((column, c) => ({ column, c }))
    .filter(({ column, c }) => c > 0 && column.property.type === "text" && column.formula === undefined)
    .filter(({ c }) => {
      const values = distinct(table, c).length;
      return values <= MAX_LANES && (values < table.rows.length || table.rows.length <= 2);
    })
    .sort((a, b) => Number(STATUS_HINT.test(b.column.name)) - Number(STATUS_HINT.test(a.column.name)))
    .map(({ c }) => c);
}

export function groupColumn(table: Table, layout: TableLayout): number | null {
  const chosen = layout.group;
  if (chosen !== undefined && table.columns[chosen]?.property.type === "text") return chosen;
  return groupCandidates(table)[0] ?? null;
}

export interface Lane {
  value: string;
  rows: number[];
}

const STAGES: RegExp[] = [
  /^(à faire|a faire|todo|to do|backlog|idée|idees?|nouveau|nouvelle|prévu|prevu|planned)$/i,
  /^(en cours|in progress|doing|commencé|commence|démarré|demarre)$/i,
  /^(en revue|à valider|a valider|review|en test|bloqué|bloque|blocked|en attente)$/i,
  DONE,
];
const UNKNOWN_STAGE = 1.5;

const stage = (value: string) => {
  const found = STAGES.findIndex((pattern) => pattern.test(value.trim()));
  return found === -1 ? UNKNOWN_STAGE : found;
};

export function lanes(table: Table, group: number, declared: string[] = []): Lane[] {
  const found = distinct(table, group).filter((value) => !declared.includes(value));
  const values = [...declared, ...(declared.length > 0 ? found : [...found].sort((a, b) => stage(a) - stage(b)))];
  const result: Lane[] = values.map((value) => ({ value, rows: [] }));
  const empty: Lane = { value: "", rows: [] };
  table.rows.forEach((_, r) => {
    const value = textAt(table, r, group);
    (result.find((lane) => lane.value === value) ?? empty).rows.push(r);
  });
  return empty.rows.length > 0 ? [...result, empty] : result;
}

export function withStatusColumn(table: Table): { table: Table; group: number } {
  const group = table.columns.length;
  return {
    group,
    table: {
      columns: [...table.columns, { name: STATUS_NAME, property: { type: "text" }, manual: true }],
      rows: table.rows.map((cells) => [...cells, { raw: DEFAULT_LANES[0], display: DEFAULT_LANES[0] }]),
    },
  };
}

/** Puts a card in a lane at a position among that lane's other cards, keeping every other row in place. */
export function moveCard(table: Table, group: number, row: number, lane: string, index: number, value: (raw: string) => Value): Table {
  const cells = table.rows[row];
  if (!cells) return table;
  const changed = textAt(table, row, group) !== lane;
  const moved = changed ? cells.map((cell, c) => (c === group ? value(lane) : cell)) : cells;
  const others = table.rows.map((_, r) => r).filter((r) => r !== row);
  const peers = others.filter((r) => textAt(table, r, group) === lane);
  const before = peers[index];
  const after = peers[index - 1];
  const fits = (before === undefined || row < before) && (after === undefined || row > after);
  if (fits) return changed ? { ...table, rows: table.rows.map((cells, r) => (r === row ? moved : cells)) } : table;
  const at = after !== undefined ? others.indexOf(after) + 1 : before !== undefined ? others.indexOf(before) : others.length;
  const order = [...others.slice(0, at), row, ...others.slice(at)];
  return { ...table, rows: order.map((r) => (r === row ? moved : table.rows[r])) };
}

export const isDone = (value: string) => DONE.test(value.trim());

export function dateColumns(table: Table): number[] {
  return table.columns.flatMap((column, c) => (column.property.type === "date" ? [c] : []));
}

const DAY_MS = 86_400_000;

const toDay = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
};

const fromDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export const addDays = (iso: string, days: number) => fromDay(toDay(iso) + days);
export const daysBetween = (from: string, to: string) => toDay(to) - toDay(from);

export function rawDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function isoAt(table: Table, row: number, column: number | undefined): string | null {
  if (column === undefined) return null;
  const typed = table.rows[row]?.[column]?.typed;
  return typed?.type === "date" ? typed.iso : null;
}

export interface Bar {
  row: number;
  from: string;
  to: string;
}

export interface Timeline {
  from: string;
  days: number;
  bars: (Bar | null)[];
}

const MIN_DAYS = 21;
const MARGIN_BEFORE = 2;
const MARGIN_AFTER = 4;

export function timelineColumns(table: Table, layout: TableLayout): { start: number | undefined; end: number | undefined } {
  const dates = dateColumns(table);
  const start = layout.start !== undefined && dates.includes(layout.start) ? layout.start : dates[0];
  const end = layout.end !== undefined && dates.includes(layout.end) && layout.end !== start ? layout.end : dates.find((c) => c !== start);
  return { start, end };
}

export function timeline(table: Table, start: number | undefined, end: number | undefined, today: string): Timeline {
  const bars = table.rows.map((_, row): Bar | null => {
    const from = isoAt(table, row, start);
    if (!from) return null;
    const to = isoAt(table, row, end);
    return to && to >= from ? { row, from, to } : { row, from, to: from };
  });
  const placed = bars.filter((bar): bar is Bar => bar !== null);
  const first = placed.reduce((min, bar) => (bar.from < min ? bar.from : min), placed[0]?.from ?? today);
  const last = placed.reduce((max, bar) => (bar.to > max ? bar.to : max), placed[0]?.to ?? today);
  const from = addDays(first, -MARGIN_BEFORE);
  const days = Math.max(MIN_DAYS, daysBetween(from, last) + 1 + MARGIN_AFTER);
  return { from, days, bars };
}
