import { flushSync } from "react-dom";
import { mergeAttributes, Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from "@tiptap/react";
import { columnSizingFeature, createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { BoardView } from "./BoardView";
import { ChartView } from "./ChartView";
import { DEFAULT_LANES, DEFAULT_LAYOUT, dateColumns, groupCandidates, groupColumn, timelineColumns, withStatusColumn } from "./layouts";
import { TimelineView } from "./TimelineView";
import type { Kertas } from "./engine";
import { autoType, emptyRow, pasteGrid, retyped, retypeAll, withCell } from "./tableOps";
import type { ChartAxes, Column, Currency, PropertyType, Sort, Table, TableLayout, TableLook, Value } from "./types";

const ROW_HEIGHT: Record<TableLook["density"], number> = { comfortable: 36, compact: 28 };
const MAX_HEIGHT = 460;
const MIN_COLUMN_PX = 48;
const EMPTY_TABLE: Table = { columns: [], rows: [] };
const DEFAULT_LOOK: TableLook = { style: "clean", density: "comfortable", freeze: true };

const LAYOUT_CHOICES: { id: TableLayout["kind"]; label: string }[] = [
  { id: "table", label: "Tableau" },
  { id: "board", label: "Kanban" },
  { id: "timeline", label: "Gantt" },
];

const STYLE_CHOICES: { id: TableLook["style"]; label: string }[] = [
  { id: "clean", label: "Épuré" },
  { id: "lines", label: "Lignes" },
  { id: "bands", label: "Bandes" },
  { id: "grid", label: "Grille" },
];

export interface CollectionOptions {
  engine: Kertas | null;
}

const PROPERTY_CHOICES: { id: string; label: string; property: (currency: Currency) => PropertyType }[] = [
  { id: "text", label: "Texte", property: () => ({ type: "text" }) },
  { id: "number", label: "Nombre", property: () => ({ type: "number" }) },
  { id: "money", label: "Montant", property: (currency) => ({ type: "money", currency }) },
  { id: "percent", label: "Pourcentage", property: () => ({ type: "percent" }) },
  { id: "date", label: "Date", property: () => ({ type: "date" }) },
  { id: "checkbox", label: "Case à cocher", property: () => ({ type: "checkbox" }) },
];

const FORMULA = "formula";
const FORMULA_HINT = "Prix * Quantité, Montant * 20 %, Fin - Début, si(Total > 100; 1; 0)…";

const INVALID_HINT: Record<PropertyType["type"], string> = {
  text: "",
  number: "Pas un nombre",
  money: "Pas un montant",
  percent: "Pas un pourcentage",
  date: "Pas une date",
  checkbox: "Ni oui ni non",
};

const isNumeric = (property: PropertyType) => ["number", "money", "percent"].includes(property.type);

const TYPE_ICONS: Record<PropertyType["type"], string> = {
  text: "Aa",
  number: "#",
  money: "€",
  percent: "%",
  date: "📅",
  checkbox: "☑",
};

const SAMPLE_ROWS = 200;
const CELL_PADDING_CH = 3;
const TEXT_MAX_CH = 32;
const TEXT_MIN_CH = 12;
const VALUE_MAX_CH = 22;
const MIN_CH = 7;

/**
 * How wide a column wants to be and how narrow it may get, in characters:
 * values (dates, amounts, numbers) keep their full width, text gives way first.
 */
function widthOf(table: Table, c: number): { min: number; ideal: number } {
  const column = table.columns[c];
  if (!column) return { min: MIN_CH, ideal: MIN_CH };
  const longest = table.rows.slice(0, SAMPLE_ROWS).reduce((max, row) => Math.max(max, (row[c]?.display ?? "").length), 0);
  const header = column.name.length + 4;
  const text = column.property.type === "text" && column.formula === undefined;
  const ideal = Math.max(MIN_CH, Math.min(text ? TEXT_MAX_CH : VALUE_MAX_CH, Math.max(header, longest + CELL_PADDING_CH)));
  return { min: text ? Math.min(ideal, TEXT_MIN_CH) : ideal, ideal };
}

interface GridRow {
  index: number;
  cells: Value[];
}

const features = tableFeatures({ columnSizingFeature });
const helper = createColumnHelper<typeof features, GridRow>();

type Move = "down" | "right" | "left" | null;

function CellInput({
  value,
  onCommit,
  onCancel,
  onPasteGrid,
}: {
  value: Value;
  onCommit: (raw: string, move: Move) => void;
  onCancel: () => void;
  onPasteGrid: (text: string) => void;
}) {
  const [draft, setDraft] = useState(value.raw);
  const done = useRef(false);
  const finish = (move: Move) => {
    if (done.current) return;
    done.current = true;
    onCommit(draft, move);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finish("down");
    } else if (event.key === "Tab") {
      event.preventDefault();
      finish(event.shiftKey ? "left" : "right");
    } else if (event.key === "Escape") {
      event.preventDefault();
      done.current = true;
      onCancel();
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.trim())) return;
    event.preventDefault();
    done.current = true;
    onPasteGrid(text);
  };
  return (
    <input
      className="kertas-cell-input"
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(null)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    />
  );
}

function FormulaInput({ formula, onCommit }: { formula: string; onCommit: (formula: string) => void }) {
  const [editing, setEditing] = useState(formula === "");
  const [draft, setDraft] = useState(formula);
  useEffect(() => setDraft(formula), [formula]);

  if (!editing) {
    return (
      <button type="button" className="kertas-header-formula-text" title="Modifier la formule" onClick={() => setEditing(true)}>
        {formula || FORMULA_HINT}
      </button>
    );
  }

  const close = (commit: boolean) => {
    setEditing(false);
    if (commit && draft !== formula) onCommit(draft);
    else setDraft(formula);
  };
  return (
    <input
      className="kertas-header-formula"
      value={draft}
      placeholder={FORMULA_HINT}
      aria-label="Formule de la colonne"
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => close(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          close(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          close(false);
        }
      }}
    />
  );
}

function CellEditor({
  value,
  property,
  formula,
  editing,
  onEdit,
  onCommit,
  onCancel,
  onPasteGrid,
}: {
  value: Value;
  property: PropertyType;
  formula?: string;
  editing: boolean;
  onEdit: () => void;
  onCommit: (raw: string, move: Move) => void;
  onCancel: () => void;
  onPasteGrid: (text: string) => void;
}) {
  const invalid = value.raw !== "" && property.type !== "text" && !value.typed;

  if (formula !== undefined) {
    return (
      <span className={`kertas-cell kertas-cell-formula${isNumeric(property) ? " kertas-cell-number" : ""}`} title={`= ${formula}`}>
        {value.display}
      </span>
    );
  }

  if (property.type === "checkbox" && !editing) {
    const checked = value.typed?.type === "checkbox" && value.typed.checked;
    return (
      <label className="kertas-cell kertas-cell-check">
        <input type="checkbox" checked={checked} onChange={(event) => onCommit(event.target.checked ? "oui" : "non", null)} />
      </label>
    );
  }

  if (editing) return <CellInput value={value} onCommit={onCommit} onCancel={onCancel} onPasteGrid={onPasteGrid} />;

  return (
    <button
      type="button"
      className={`kertas-cell${isNumeric(property) ? " kertas-cell-number" : ""}${invalid ? " kertas-cell-invalid" : ""}`}
      title={invalid ? INVALID_HINT[property.type] : value.display || undefined}
      onClick={onEdit}
    >
      {value.display}
    </button>
  );
}

function ColumnHeader({
  column,
  sort,
  onRename,
  onRetype,
  onFormula,
  onSort,
  onResizeStart,
  onResetWidth,
}: {
  column: Column;
  sort: "asc" | "desc" | null;
  onRename: (name: string) => void;
  onRetype: (choice: string) => void;
  onFormula: (formula: string) => void;
  onSort: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onResetWidth: () => void;
}) {
  const { name, property, formula } = column;
  const computed = formula !== undefined;
  return (
    <div className={`kertas-header${computed ? " kertas-header-computed" : ""}`}>
      <input className="kertas-header-name" value={name} onChange={(event) => onRename(event.target.value)} aria-label="Nom de la colonne" />
      <span className="kertas-header-type" title="Type de la colonne">
        <span aria-hidden="true">{computed ? "ƒ" : TYPE_ICONS[property.type]}</span>
        <select value={computed ? FORMULA : property.type} onChange={(event) => onRetype(event.target.value)} aria-label="Type de la colonne">
          {PROPERTY_CHOICES.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
              {choice.id === "money" && property.type === "money" && !computed ? ` (${property.currency})` : ""}
            </option>
          ))}
          <option value={FORMULA}>Formule</option>
        </select>
      </span>
      <button type="button" className={`kertas-header-sort${sort ? " kertas-header-sort-on" : ""}`} onClick={onSort} title="Trier">
        {sort === "asc" ? "↑" : sort === "desc" ? "↓" : "↕"}
      </button>
      {computed && (
        <div className="kertas-header-formula-line">
          <span aria-hidden="true">=</span>
          <FormulaInput formula={formula} onCommit={onFormula} />
          {column.formula_error && (
            <span className="kertas-header-formula-error" role="status">
              {column.formula_error}
            </span>
          )}
        </div>
      )}
      <span
        className="kertas-resize"
        role="separator"
        aria-orientation="vertical"
        title="Glisser pour élargir, double-cliquer pour revenir à la largeur automatique"
        onPointerDown={onResizeStart}
        onDoubleClick={onResetWidth}
      />
    </div>
  );
}

/** True while the page prints: every row is drawn then, not only those in view. */
function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return printing;
}

function CollectionView({ node, updateAttributes, extension }: ReactNodeViewProps) {
  const engine = (extension.options as CollectionOptions).engine;
  const table = (node.attrs.table as Table | undefined) ?? EMPTY_TABLE;
  const axes = (node.attrs.chart as ChartAxes | null | undefined) ?? null;
  const look: TableLook = { ...DEFAULT_LOOK, ...(node.attrs.look as Partial<TableLook> | null) };
  const layout: TableLayout = { ...DEFAULT_LAYOUT, ...(node.attrs.layout as Partial<TableLayout> | null) };
  const rowHeight = ROW_HEIGHT[look.density];
  const [resizing, setResizing] = useState<{ column: number; width: number } | null>(null);
  const [sort, setSort] = useState<Sort | null>(null);
  const [editing, setEditing] = useState<{ row: number; column: number } | null>(null);
  const printing = usePrinting();
  const [appended, setAppended] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const update = (next: Table) =>
    updateAttributes({ table: engine && next.columns.some((column) => column.formula !== undefined) ? engine.compute(next) : next });
  const setAxes = (next: ChartAxes | null) => updateAttributes({ chart: next });
  const setLook = (next: Partial<TableLook>) => updateAttributes({ look: { ...look, ...next } });
  const setLayout = (next: TableLayout) => updateAttributes({ layout: next.kind === "table" && Object.keys(next).length === 1 ? null : next });
  const view = useMemo(() => engine?.view(table, sort) ?? { order: table.rows.map((_, i) => i), totals: [] }, [engine, table, sort]);
  const chart = useMemo(() => (engine && axes ? engine.chart(table, axes) : null), [engine, table, axes]);
  const chartable = useMemo(() => (engine && !axes ? engine.chart(table) : null), [engine, table, axes]);
  const data = useMemo<GridRow[]>(() => view.order.map((index) => ({ index, cells: table.rows[index] ?? [] })), [view, table]);

  const columnCount = table.columns.length;
  const columns = useMemo(
    () =>
      helper.columns(
        Array.from({ length: columnCount }, (_, c) =>
          helper.accessor((row) => row.cells[c]?.raw ?? "", { id: String(c), size: c === 0 ? 200 : 150 }),
        ),
      ),
    [columnCount],
  );
  const grid = useTable({ features, columns, data, getRowId: (row) => String(row.index) });
  const rows = grid.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  const editingPosition = editing ? view.order.indexOf(editing.row) : -1;
  useEffect(() => {
    if (editingPosition >= 0) virtualizer.scrollToIndex(editingPosition);
  }, [editingPosition, virtualizer]);

  if (!engine) return <NodeViewWrapper className="kertas-collection">Moteur kertas indisponible</NodeViewWrapper>;

  const fixed = table.columns.map((column, c) => (resizing?.column === c ? resizing.width : column.width));
  const widths = table.columns.map((_, c) => widthOf(table, c));
  const template = widths.map(({ min, ideal }, c) => (fixed[c] ? `${fixed[c]}px` : `minmax(${min}ch, ${ideal}fr)`)).join(" ");
  const minWidth = `calc(${widths.reduce((sum, { min }, c) => sum + (fixed[c] ? 0 : min), 0)}ch + ${fixed.reduce<number>((sum, px) => sum + (px ?? 0), 0)}px)`;

  const setWidth = (column: number, width: number | undefined) =>
    update({
      ...table,
      columns: table.columns.map((col, c) => {
        if (c !== column) return col;
        const { width: _width, ...rest } = col;
        return width === undefined ? rest : { ...rest, width };
      }),
    });

  const startResize = (column: number, event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = Math.round(handle.parentElement?.getBoundingClientRect().width ?? MIN_COLUMN_PX);
    let width = startWidth;
    handle.setPointerCapture(event.pointerId);
    const move = (moved: PointerEvent) => {
      width = Math.max(MIN_COLUMN_PX, Math.round(startWidth + moved.clientX - startX));
      setResizing({ column, width });
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setResizing(null);
      if (width !== startWidth) setWidth(column, width);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const save = (next: Table) => update(autoType(engine, next));

  const target = (row: number, column: number, move: Move): { row: number; column: number; append: boolean } | null => {
    const position = view.order.indexOf(row);
    const below = view.order[position + 1];
    const above = view.order[position - 1];
    const last = table.columns.length - 1;
    if (move === "down") return below === undefined ? { row: table.rows.length, column, append: true } : { row: below, column, append: false };
    if (move === "right" && column < last) return { row, column: column + 1, append: false };
    if (move === "right") return below === undefined ? { row: table.rows.length, column: 0, append: true } : { row: below, column: 0, append: false };
    if (move === "left" && column > 0) return { row, column: column - 1, append: false };
    if (move === "left" && above !== undefined) return { row: above, column: last, append: false };
    return null;
  };

  const commitCell = (row: number, column: number, raw: string, move: Move) => {
    let next = table;
    if (raw !== (table.rows[row]?.[column]?.raw ?? "") && table.columns[column]?.formula === undefined) {
      const property = table.columns[column]?.property ?? { type: "text" };
      const [value] = engine.typeValues([raw], property);
      next = withCell(next, row, column, value);
    }
    const goal = target(row, column, move);
    if (goal?.append) next = { ...next, rows: [...next.rows, emptyRow(next)] };
    if (appended !== null && goal?.row !== appended) next = dropIfEmpty(next, appended);
    if (next !== table) save(next);
    setAppended(goal?.append ? goal.row : goal?.row === appended ? appended : null);
    setEditing(goal ? { row: goal.row, column: goal.column } : null);
  };

  const dropIfEmpty = (current: Table, row: number): Table => {
    const cells = current.rows[row];
    if (!cells || cells.some((cell) => cell.raw.trim() !== "")) return current;
    return { ...current, rows: current.rows.filter((_, r) => r !== row) };
  };

  const cancelEdit = () => {
    if (appended !== null) {
      const next = dropIfEmpty(table, appended);
      if (next !== table) update(next);
    }
    setAppended(null);
    setEditing(null);
  };

  const pasteCells = (row: number, column: number, text: string) => {
    save(retypeAll(engine, pasteGrid(table, text, row, column)));
    setEditing(null);
  };

  const retypeColumn = (column: number, choice: string) => {
    if (choice === FORMULA) {
      update({ ...table, columns: table.columns.map((col, c) => (c === column ? { ...col, formula: col.formula ?? "", manual: true } : col)) });
      return;
    }
    const option = PROPERTY_CHOICES.find((c) => c.id === choice);
    if (!option) return;
    const { formula: _formula, formula_error: _error, ...kept } = table.columns[column] ?? { name: "", property: { type: "text" } };
    const base = { ...table, columns: table.columns.map((col, c) => (c === column ? kept : col)) };
    const firstCurrency = table.rows.map((cells) => cells[column]?.typed).find((t) => t?.type === "money");
    const currency = firstCurrency?.type === "money" ? firstCurrency.currency : "EUR";
    const next = retyped(engine, base, column, option.property(currency));
    update({ ...next, columns: next.columns.map((col, c) => (c === column ? { ...col, manual: true } : col)) });
  };

  const setFormula = (column: number, formula: string) =>
    update({ ...table, columns: table.columns.map((col, c) => (c === column ? { ...col, formula: formula.trim() } : col)) });

  const renameColumn = (column: number, name: string) =>
    update({ ...table, columns: table.columns.map((col, c) => (c === column ? { ...col, name } : col)) });

  const cycleSort = (column: number) =>
    setSort((current) => {
      if (current?.column !== column) return { column, descending: false };
      return current.descending ? null : { column, descending: true };
    });

  const addRow = () => {
    update({ ...table, rows: [...table.rows, emptyRow(table)] });
    setAppended(table.rows.length);
    setEditing({ row: table.rows.length, column: 0 });
  };

  const downloadCsv = () => {
    const blob = new Blob(["\ufeff", engine.exportTable(table, "csv")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${table.columns[0]?.name ?? "tableau"}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const group = groupColumn(table, layout);
  const span = timelineColumns(table, layout);

  const chooseLayout = (kind: TableLayout["kind"]) => {
    if (kind === "board" && group === null) {
      const made = withStatusColumn(table);
      updateAttributes({ table: made.table, layout: { ...layout, kind, group: made.group, lanes: DEFAULT_LANES } });
      return;
    }
    if (kind === "timeline" && dateColumns(table).length === 0) {
      const date: PropertyType = { type: "date" };
      updateAttributes({
        table: {
          columns: [...table.columns, { name: "Début", property: date, manual: true }, { name: "Fin", property: date, manual: true }],
          rows: table.rows.map((cells) => [...cells, { raw: "", display: "" }, { raw: "", display: "" }]),
        },
        layout: { ...layout, kind },
      });
      return;
    }
    setLayout({ ...layout, kind });
  };

  const addColumn = () =>
    update({
      columns: [...table.columns, { name: `Colonne ${table.columns.length + 1}`, property: { type: "text" } }],
      rows: table.rows.map((cells) => [...cells, { raw: "", display: "" }]),
    });

  return (
    <NodeViewWrapper
      className={`kertas-collection kertas-look-${look.style} kertas-density-${look.density}${look.freeze ? " kertas-freeze" : ""}${resizing ? " kertas-resizing" : ""}`}
      contentEditable={false}
      data-drag-handle=""
    >
      <div className="kertas-layout-switch" role="tablist" aria-label="Affichage">
        {LAYOUT_CHOICES.map((choice) => (
          <button key={choice.id} type="button" role="tab" aria-selected={layout.kind === choice.id} onClick={() => chooseLayout(choice.id)}>
            {choice.label}
          </button>
        ))}
      </div>
      {layout.kind === "board" && group !== null && (
        <BoardView engine={engine} table={table} layout={layout} group={group} onTable={update} onLayout={setLayout} />
      )}
      {layout.kind === "timeline" && span.start !== undefined && (
        <TimelineView engine={engine} table={table} start={span.start} end={span.end} group={group} onTable={update} />
      )}
      {layout.kind === "table" && (
      <div ref={scroller} className="kertas-scroll" style={{ maxHeight: MAX_HEIGHT }}>
        <div className="kertas-sheet" style={{ minWidth }}>
          <div className="kertas-grid kertas-head" style={{ gridTemplateColumns: template }} role="row">
            {table.columns.map((column, c) => (
              <ColumnHeader
                key={c}
                column={column}
                sort={sort?.column === c ? (sort.descending ? "desc" : "asc") : null}
                onRename={(name) => renameColumn(c, name)}
                onRetype={(choice) => retypeColumn(c, choice)}
                onFormula={(formula) => setFormula(c, formula)}
                onSort={() => cycleSort(c)}
                onResizeStart={(event) => startResize(c, event)}
                onResetWidth={() => setWidth(c, undefined)}
              />
            ))}
          </div>
          <div className="kertas-rows" style={{ height: printing ? rows.length * rowHeight : virtualizer.getTotalSize() }}>
            {(printing ? rows.map((_, index) => ({ index, start: index * rowHeight })) : virtualizer.getVirtualItems()).map((item) => {
              const row = rows[item.index];
              return (
                <div
                  key={row.id}
                  className="kertas-grid kertas-row"
                  role="row"
                  data-band={item.index % 2 === 1 ? "" : undefined}
                  style={{ gridTemplateColumns: template, height: rowHeight, transform: `translateY(${item.start}px)` }}
                >
                  {row.getAllCells().map((cell) => {
                    const c = Number(cell.column.id);
                    const value = row.original.cells[c] ?? { raw: "", display: "" };
                    return (
                      <CellEditor
                        key={cell.id}
                        value={value}
                        property={table.columns[c].property}
                        formula={table.columns[c].formula}
                        editing={editing?.row === row.original.index && editing.column === c}
                        onEdit={() => setEditing({ row: row.original.index, column: c })}
                        onCommit={(raw, move) => commitCell(row.original.index, c, raw, move)}
                        onCancel={cancelEdit}
                        onPasteGrid={(text) => pasteCells(row.original.index, c, text)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="kertas-grid kertas-totals" style={{ gridTemplateColumns: template }}>
            {table.columns.map((column, c) => (
              <span key={c} className={isNumeric(column.property) ? "kertas-cell-number" : undefined} title={view.totals[c]?.display}>
                {view.totals[c]?.display ?? ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      )}
      <div className="kertas-actions">
        {layout.kind !== "board" && (
          <button type="button" onClick={addRow}>
            + Ligne
          </button>
        )}
        <button type="button" onClick={addColumn}>
          + Colonne
        </button>
        {layout.kind === "table" && chartable && (
          <button type="button" onClick={() => setAxes({ x: chartable.x, y: chartable.y })}>
            + Graphique
          </button>
        )}
        <button type="button" onClick={downloadCsv}>
          Exporter CSV
        </button>
        <span className="kertas-count">{table.rows.length} lignes</span>
        {layout.kind === "board" && group !== null && (
          <label className="kertas-layout-pick">
            Grouper par
            <select value={group} onChange={(event) => setLayout({ ...layout, group: Number(event.target.value), lanes: undefined })}>
              {[...new Set([group, ...groupCandidates(table)])].map((c) => (
                <option key={c} value={c}>
                  {table.columns[c]?.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {layout.kind === "timeline" && span.start !== undefined && (
          <>
            <label className="kertas-layout-pick">
              Début
              <select value={span.start} onChange={(event) => setLayout({ ...layout, start: Number(event.target.value) })}>
                {dateColumns(table).map((c) => (
                  <option key={c} value={c}>
                    {table.columns[c]?.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="kertas-layout-pick">
              Fin
              <select value={span.end ?? -1} onChange={(event) => setLayout({ ...layout, end: Number(event.target.value) < 0 ? undefined : Number(event.target.value) })}>
                <option value={-1}>—</option>
                {dateColumns(table)
                  .filter((c) => c !== span.start)
                  .map((c) => (
                    <option key={c} value={c}>
                      {table.columns[c]?.name}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        {layout.kind === "table" && (
        <span className="kertas-look-controls">
          <select value={look.style} onChange={(event) => setLook({ style: event.target.value as TableLook["style"] })} aria-label="Style du tableau">
            {STYLE_CHOICES.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setLook({ density: look.density === "compact" ? "comfortable" : "compact" })}>
            {look.density === "compact" ? "Aéré" : "Compact"}
          </button>
          <button type="button" aria-pressed={look.freeze} onClick={() => setLook({ freeze: !look.freeze })} title="Garder la première colonne visible en défilant">
            {look.freeze ? "Libérer la 1re colonne" : "Figer la 1re colonne"}
          </button>
        </span>
        )}
      </div>
      {layout.kind === "table" && axes && <ChartView chart={chart} columns={table.columns} axes={axes} onChange={setAxes} onRemove={() => setAxes(null)} />}
    </NodeViewWrapper>
  );
}

/**
 * A table pasted from a page or a mail, typed by the engine like a pasted
 * grid of text. Layout tables, as mails nest them, are left to other rules.
 */
export function tableFromElement(element: HTMLElement, engine: Kertas | null): Table | null {
  if (!engine || element.getAttribute("role") === "presentation" || element.querySelector("table")) return null;
  const rows = [...element.querySelectorAll("tr")]
    .map((tr) => [...tr.querySelectorAll("th, td")].map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()))
    .filter((cells) => cells.some(Boolean));
  if (rows.length < 2 || Math.max(...rows.map((r) => r.length)) < 2) return null;
  const block = engine.parse(rows.map((cells) => cells.join("\t")).join("\n")).find((b) => b.kind === "table");
  return block && block.kind === "table" ? block.table : null;
}

export const Collection = Node.create<CollectionOptions>({
  name: "collection",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { engine: null };
  },

  addAttributes() {
    const engine = this.options.engine;
    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-id"),
        renderHTML: (attributes) => (attributes.id ? { "data-id": attributes.id } : {}),
      },
      table: {
        default: EMPTY_TABLE,
        parseHTML: (element) =>
          element.tagName === "TABLE" ? (tableFromElement(element, engine) ?? EMPTY_TABLE) : (JSON.parse(element.getAttribute("data-table") ?? "null") ?? EMPTY_TABLE),
        renderHTML: (attributes) => ({ "data-table": JSON.stringify(attributes.table) }),
      },
      chart: {
        default: null,
        parseHTML: (element) => JSON.parse(element.getAttribute("data-chart") ?? "null"),
        renderHTML: (attributes) => (attributes.chart ? { "data-chart": JSON.stringify(attributes.chart) } : {}),
      },
      layout: {
        default: null,
        parseHTML: (element) => JSON.parse(element.getAttribute("data-layout") ?? "null"),
        renderHTML: (attributes) => (attributes.layout ? { "data-layout": JSON.stringify(attributes.layout) } : {}),
      },
      look: {
        default: null,
        parseHTML: (element) => JSON.parse(element.getAttribute("data-look") ?? "null"),
        renderHTML: (attributes) => (attributes.look ? { "data-look": JSON.stringify(attributes.look) } : {}),
      },
    };
  },

  parseHTML() {
    const engine = this.options.engine;
    return [
      { tag: "div[data-kertas-collection]" },
      {
        tag: "table",
        priority: 60,
        getAttrs: (element) => (tableFromElement(element, engine) ? null : false),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-kertas-collection": "" })];
  },

  renderText({ node }) {
    const table = (node.attrs.table as Table | undefined) ?? EMPTY_TABLE;
    return this.options.engine?.exportTable(table, "markdown") ?? "";
  },

  addNodeView() {
    return ReactNodeViewRenderer(CollectionView);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("kertasCollectionIds"),
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const seen = new Set<string>();
          const tr = state.tr;
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "collection") return node.isBlock;
            const id = node.attrs.id as string | null;
            if (id && !seen.has(id)) {
              seen.add(id);
              return false;
            }
            const fresh = crypto.randomUUID();
            seen.add(fresh);
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: fresh });
            return false;
          });
          return tr.docChanged ? tr.setMeta("addToHistory", false) : null;
        },
      }),
    ];
  },
});
