export type Currency = "EUR" | "USD" | "GBP" | "CHF";

export type PropertyType =
  | { type: "text" }
  | { type: "number" }
  | { type: "money"; currency: Currency }
  | { type: "percent" }
  | { type: "date" }
  | { type: "checkbox" };

export type Typed =
  | { type: "number"; units: number; scale: number }
  | { type: "money"; minor: number; currency: Currency }
  | { type: "percent"; units: number; scale: number }
  | { type: "date"; iso: string }
  | { type: "checkbox"; checked: boolean };

export interface Value {
  raw: string;
  typed?: Typed;
  display: string;
}

export interface Column {
  name: string;
  property: PropertyType;
  manual?: boolean;
  formula?: string;
  formula_error?: string;
  width?: number;
}

/** How a table is drawn: which rules separate it, how tight its rows are, whether its first column stays in view. */
export interface TableLook {
  style: "clean" | "lines" | "bands" | "grid";
  density: "comfortable" | "compact";
  freeze: boolean;
}

/** Which view a table is shown in: rows, cards grouped by a column, or bars on a calendar. */
export interface TableLayout {
  kind: "table" | "board" | "timeline";
  group?: number;
  lanes?: string[];
  start?: number;
  end?: number;
}

export interface Table {
  columns: Column[];
  rows: Value[][];
}

export type Confidence = "certain" | "likely";

export type Block =
  | { kind: "paragraph" }
  | { kind: "heading"; level: number; confidence: Confidence }
  | { kind: "list"; ordered: boolean; items: string[]; confidence: Confidence }
  | { kind: "table"; table: Table; confidence: Confidence }
  | { kind: "create_table"; columns: number; rows: number; subject: string | null; table: Table };

export interface Edit {
  from: number;
  to: number;
  insert: string;
}

export interface Emphasis {
  from: number;
  to: number;
  mark: "bold" | "italic";
  reason: "foreign_word" | "cited_word" | "label" | "deadline";
}

export type Lang = "fr" | "en";

export interface Misspelling {
  from: number;
  to: number;
  word: string;
  correction: string | null;
  lang: Lang;
}

export interface ChartPoint {
  label: string;
  value: number;
  display: string;
}

export interface Chart {
  x: number;
  y: number;
  axis: "category" | "time";
  title: string;
  points: ChartPoint[];
}

export interface ChartAxes {
  x: number;
  y: number;
}

export interface Answer {
  lang: Lang;
  measure: "count" | "sum" | "mean" | "median" | "min" | "max";
  column: number;
  text: string;
}

export interface Moment {
  kind: "appointment" | "reminder" | "note" | "mail";
  kind_found: boolean;
  day: string;
  day_found: boolean;
  hour: number;
  minute: number;
  has_time: boolean;
  title: string;
}

export interface Link {
  kind: "page" | "table" | "event" | "board" | "resource";
  target: string;
}

export interface StoredNote {
  version: number;
  document: Record<string, unknown>;
}

export interface NoteRecord {
  version: number;
  document: Record<string, unknown>;
  markdown: string;
  links: Link[];
}

export interface Sort {
  column: number;
  descending: boolean;
}

export interface Total {
  display: string;
  values: Typed[];
}

export interface View {
  order: number[];
  totals: (Total | null)[];
}

export type Mark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "code" }
  | { type: "strike" }
  | { type: "link"; href: string };

export interface Inline {
  text: string;
  marks?: Mark[];
}

export type DocBlock =
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "heading"; level: number; content: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; items: DocBlock[][] }
  | { kind: "quote"; blocks: DocBlock[] }
  | { kind: "code"; language: string | null; text: string }
  | { kind: "rule" }
  | { kind: "table"; table: Table };

export interface FindRef {
  kind: string;
  id: string;
}

export interface FindItem extends FindRef {
  title: string;
  text?: string;
  at?: string;
  url?: string;
  tags?: string[];
  facts?: string[];
  links?: FindRef[];
}

export interface FindLinked extends FindRef {
  title: string;
  at: string;
}

export interface FindHit extends FindRef {
  title: string;
  snippet: string;
  at: string;
  url: string;
  tags: string[];
  facts: string[];
  linked: FindLinked[];
}

export interface FindTopic {
  name: string;
  notes: number;
  sources: number;
}
