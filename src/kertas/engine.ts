import type { Answer, Block, FindHit, FindItem, FindRef, FindTopic, Link, Moment, NoteRecord, StoredNote, Chart, ChartAxes, DocBlock, Edit, Emphasis, Lang, Misspelling, PropertyType, Sort, Table, Value, View } from "./types";

interface Exports {
  memory: WebAssembly.Memory;
  kertas_alloc(len: number): number;
  kertas_call(ptr: number, len: number): number;
  kertas_free(ptr: number, len: number): void;
}

export interface Kertas {
  classify(text: string, next?: string): Block;
  normalize(text: string): Edit[];
  emphasize(text: string): Emphasis[];
  loadDictionary(lang: Lang, aff: string, dic: string): boolean;
  spell(text: string): Misspelling[];
  suggest(word: string, lang: Lang): string[];
  readonly spelling: boolean;
  language: Lang;
  parse(text: string): DocBlock[];
  typeValues(raws: string[], property: PropertyType): Value[];
  view(table: Table, sort?: Sort | null): View;
  chart(table: Table, axes?: ChartAxes | null): Chart | null;
  infer(raws: string[]): PropertyType;
  understand(line: string): Moment;
  exportTable(table: Table, format: "csv" | "markdown"): string;
  importCsv(text: string): Table | null;
  /** Fills the formula columns of a table from the other columns of each row. */
  compute(table: Table): Table;
  /** Every day the text names, with UTF-16 offsets an editor can use. */
  recognizeDays(text: string): { from: number; to: number; day: string }[];
  links(document: object): Link[];
  toMarkdown(document: object): string;
  fromMarkdown(markdown: string): Record<string, unknown>;
  recordNote(document: object): NoteRecord;
  openNote(stored: StoredNote | string): Record<string, unknown>;
  rowsFor(table: Table, text: string): Value[][] | null;
  answer(table: Table, question: string): Answer | null;
  measure(table: Table, column: number, measure: Answer["measure"], lang: Lang): Answer | null;
  reindex(items: FindItem[]): number;
  indexChange(put: FindItem[], drop: FindRef[]): number;
  find(query: string, kinds: string[], limit: number): FindHit[];
  topics(query: string, limit: number): FindTopic[];
  readonly lastCallMs: number;
}

export class KertasError extends Error {
  override name = "KertasError";
}

const LENGTH_PREFIX = 4;

function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type CallJson = (request: string) => string;

function wasmCall(instance: WebAssembly.Instance): CallJson {
  const exports = instance.exports as unknown as Exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return (request) => {
    const input = encoder.encode(request);
    const ptr = exports.kertas_alloc(input.length) >>> 0;
    new Uint8Array(exports.memory.buffer, ptr, input.length).set(input);
    const out = exports.kertas_call(ptr, input.length) >>> 0;
    exports.kertas_free(ptr, input.length);
    if (out === 0) throw new KertasError("the engine returned no answer");
    const len = new DataView(exports.memory.buffer).getUint32(out, true);
    const json = decoder.decode(new Uint8Array(exports.memory.buffer, out + LENGTH_PREFIX, len));
    exports.kertas_free(out, LENGTH_PREFIX + len);
    return json;
  };
}

export function kertasFrom(instance: WebAssembly.Instance, now: () => Date = () => new Date(), initialLanguage: Lang = "fr"): Kertas {
  return kertasFromCall(wasmCall(instance), now, initialLanguage);
}

export function kertasFromCall(callJson: CallJson, now: () => Date = () => new Date(), initialLanguage: Lang = "fr"): Kertas {
  let lastCallMs = 0;

  const call = <T>(request: object): T => {
    const started = performance.now();
    const json = callJson(JSON.stringify(request));
    lastCallMs = performance.now() - started;
    const answer = JSON.parse(json) as { ok: T } | { error: string };
    if ("error" in answer) throw new KertasError(answer.error);
    return answer.ok;
  };

  let language = initialLanguage;
  const context = () => ({ today: isoDay(now()), lang: language });
  const dictionaries = new Set<Lang>();

  return {
    classify: (text, next) => call({ op: "classify", text, next: next ?? null, context: context() }),
    normalize: (text) => call({ op: "normalize", text, lang: language }),
    emphasize: (text) => call({ op: "emphasize", text, context: context() }),
    loadDictionary: (lang, aff, dic) => {
      const loaded = call<boolean>({ op: "load_dictionary", lang, aff, dic });
      dictionaries.add(lang);
      return loaded;
    },
    spell: (text) => (dictionaries.size > 0 ? call({ op: "spell", text, lang: language }) : []),
    suggest: (word, lang) => (dictionaries.has(lang) ? call({ op: "suggest", word, lang }) : []),
    get spelling() {
      return dictionaries.size > 0;
    },
    get language() {
      return language;
    },
    set language(lang: Lang) {
      language = lang;
    },
    parse: (text) => call({ op: "parse", text, context: context() }),
    typeValues: (raws, property) => call({ op: "type_values", raws, property, context: context() }),
    view: (table, sort) => call({ op: "view", table, sort: sort ?? null }),
    infer: (raws) => call({ op: "infer", raws, context: context() }),
    understand: (line) => call({ op: "understand", line, context: context() }),
    exportTable: (table, format) => call({ op: "export", table, format, lang: language }),
    links: (document) => call({ op: "links", document }),
    toMarkdown: (document) => call({ op: "to_markdown", document }),
    recordNote: (document) => call({ op: "record_note", document }),
    openNote: (stored) => call({ op: "open_note", stored, context: context() }),
    fromMarkdown: (markdown) => call({ op: "from_markdown", markdown, context: context() }),
    importCsv: (text) => call({ op: "import_csv", text, context: context() }),
    compute: (table) => call({ op: "compute", table, context: context() }),
    recognizeDays: (text) => call({ op: "recognize_days", text, context: context() }),
    answer: (table, question) => call({ op: "answer", table, question }),
    measure: (table, column, measure, lang) => call({ op: "measure", table, column, measure, lang }),
    rowsFor: (table, text) => call({ op: "rows_for", table, text, context: context() }),
    chart: (table, axes) => call({ op: "chart", table, x: axes?.x ?? null, y: axes?.y ?? null, lang: language }),
    reindex: (items) => call({ op: "index", items }),
    indexChange: (put, drop) => call({ op: "index_change", put, drop }),
    find: (query, kinds, limit) => call({ op: "find", query, kinds, limit }),
    topics: (query, limit) => call({ op: "topics", query, limit }),
    get lastCallMs() {
      return lastCallMs;
    },
  };
}

export async function loadKertas(source: string | URL, now?: () => Date, lang?: Lang): Promise<Kertas> {
  const response = await fetch(source);
  if (!response.ok) throw new KertasError(`kertas.wasm is not served at ${String(source)} (${response.status})`);
  const served = response.headers.get("content-type")?.startsWith("application/wasm");
  const { instance } = served
    ? await WebAssembly.instantiateStreaming(response, {})
    : await WebAssembly.instantiate(await response.arrayBuffer(), {});
  return kertasFrom(instance, now, lang);
}
