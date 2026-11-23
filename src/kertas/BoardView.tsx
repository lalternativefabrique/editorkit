import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";

import type { Kertas } from "./engine";
import { isDone, lanes as laneList, moveCard, type Lane } from "./layouts";
import { emptyRow, withCell } from "./tableOps";
import type { Table, TableLayout } from "./types";

const DRAG_THRESHOLD_PX = 4;
const EDGE_PX = 48;
const EDGE_SPEED = 14;
const MAX_FIELDS = 3;

interface Drag {
  row: number;
  width: number;
  height: number;
  grabX: number;
  grabY: number;
}

interface Slot {
  lane: string;
  index: number;
}

const PERSON = /responsable|assigné|assigne|qui|owner|personne|pilote|porteur|contact/i;
const AVATAR_COLORS = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#0d9488", "#4f46e5", "#ca8a04"];
const avatarColor = (name: string) => AVATAR_COLORS[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % AVATAR_COLORS.length];
const SHORT_DAY = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const shortDay = (iso: string) => SHORT_DAY.format(new Date(`${iso}T00:00:00Z`));

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function CardMeta({ table, row, group, done }: { table: Table; row: number; group: number; done: boolean }) {
  const cells = table.rows[row] ?? [];
  const dates = table.columns.flatMap((column, c) => {
    const typed = cells[c]?.typed;
    return column.property.type === "date" && typed?.type === "date" ? [typed.iso] : [];
  });
  const people: string[] = [];
  const others: { c: number; text: string }[] = [];
  table.columns.forEach((column, c) => {
    const text = cells[c]?.display ?? "";
    if (c === 0 || c === group || text === "" || column.property.type === "date" || column.property.type === "checkbox") return;
    if (column.property.type === "text" && PERSON.test(column.name)) people.push(text);
    else others.push({ c, text });
  });
  const due = dates.at(-1);
  const late = !done && due !== undefined && due < todayIso();
  if (dates.length === 0 && people.length === 0 && others.length === 0) return null;
  return (
    <div className="kertas-card-meta">
      {dates.length > 0 && (
        <span className={`kertas-card-date${late ? " kertas-card-late" : ""}`}>
          {dates.length > 1 && dates[0] !== due ? `${shortDay(dates[0])} → ${shortDay(due!)}` : shortDay(due!)}
        </span>
      )}
      {others.slice(0, MAX_FIELDS).map(({ c, text }) => (
        <span key={c} className="kertas-card-field" title={table.columns[c].name}>
          {text}
        </span>
      ))}
      {people.length > 0 && (
        <span className="kertas-card-people">
          {people.map((name) => (
            <span key={name} className="kertas-avatar" title={name} style={{ background: avatarColor(name) }}>
              {name.trim().charAt(0).toUpperCase()}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

function Card({
  table,
  row,
  group,
  dragging,
  onPointerDown,
  onRename,
}: {
  table: Table;
  row: number;
  group: number;
  dragging?: boolean;
  onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  onRename?: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const title = table.rows[row]?.[0]?.display || "Sans titre";
  const done = isDone(table.rows[row]?.[group]?.raw ?? "");

  const finish = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onRename?.(event.currentTarget.value);
      setEditing(false);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setEditing(false);
    }
  };

  return (
    <article
      className={`kertas-card${dragging ? " kertas-card-placeholder" : ""}${done ? " kertas-card-done" : ""}`}
      data-row={row}
      onPointerDown={editing ? undefined : onPointerDown}
      onDoubleClick={() => onRename && setEditing(true)}
    >
      {editing ? (
        <input
          className="kertas-card-input"
          defaultValue={table.rows[row]?.[0]?.raw ?? ""}
          autoFocus
          onKeyDown={finish}
          onBlur={(event) => {
            onRename?.(event.currentTarget.value);
            setEditing(false);
          }}
          aria-label="Titre de la carte"
        />
      ) : (
        <strong>{title}</strong>
      )}
      <CardMeta table={table} row={row} group={group} done={done} />
    </article>
  );
}

function AddCard({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="kertas-lane-add" onClick={() => setOpen(true)}>
        + Ajouter une carte
      </button>
    );
  return (
    <input
      className="kertas-card-input"
      placeholder="Titre de la carte, puis Entrée"
      autoFocus
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          const title = event.currentTarget.value.trim();
          if (title) onAdd(title);
          event.currentTarget.value = "";
        } else if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
        }
      }}
      onBlur={() => setOpen(false)}
      aria-label="Nouvelle carte"
    />
  );
}

function AddLane({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="kertas-lane kertas-lane-new" onClick={() => setOpen(true)}>
        + Ajouter une liste
      </button>
    );
  return (
    <div className="kertas-lane kertas-lane-new">
      <input
        className="kertas-card-input"
        placeholder="Nom de la liste"
        autoFocus
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            const name = event.currentTarget.value.trim();
            if (name) onAdd(name);
            setOpen(false);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
        onBlur={() => setOpen(false)}
        aria-label="Nouvelle liste"
      />
    </div>
  );
}

export function BoardView({
  engine,
  table,
  layout,
  group,
  onTable,
  onLayout,
}: {
  engine: Kertas;
  table: Table;
  layout: TableLayout;
  group: number;
  onTable: (next: Table) => void;
  onLayout: (next: TableLayout) => void;
}) {
  const lanes = laneList(table, group, layout.lanes);
  const board = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const slotRef = useRef<Slot | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const frame = useRef(0);

  const typed = (column: number, raw: string) => engine.typeValues([raw], table.columns[column]?.property ?? { type: "text" })[0];

  const placeGhost = () => {
    frame.current = 0;
    const el = ghost.current;
    const current = dragRef.current;
    if (!el || !current) return;
    el.style.transform = `translate3d(${pointer.current.x - current.grabX}px, ${pointer.current.y - current.grabY}px, 0) rotate(2deg)`;
    const scroller = board.current;
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      if (pointer.current.x < box.left + EDGE_PX) scroller.scrollLeft -= EDGE_SPEED;
      else if (pointer.current.x > box.right - EDGE_PX) scroller.scrollLeft += EDGE_SPEED;
    }
    const next = slotAt(pointer.current.x, pointer.current.y, current.row);
    if (next && (next.lane !== slotRef.current?.lane || next.index !== slotRef.current?.index)) {
      slotRef.current = next;
      setSlot(next);
    }
    if (dragRef.current) frame.current = requestAnimationFrame(placeGhost);
  };

  const slotAt = (x: number, y: number, row: number): Slot | null => {
    const root = board.current;
    if (!root) return null;
    const laneEls = [...root.querySelectorAll<HTMLElement>("[data-lane]")];
    const laneEl = laneEls.find((el) => {
      const box = el.getBoundingClientRect();
      return x >= box.left && x <= box.right;
    });
    if (!laneEl) return slotRef.current;
    const cards = [...laneEl.querySelectorAll<HTMLElement>(".kertas-card[data-row]")].filter((el) => Number(el.dataset.row) !== row);
    const index = cards.findIndex((el) => {
      const box = el.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    return { lane: laneEl.dataset.lane ?? "", index: index === -1 ? cards.length : index };
  };

  const stop = (commit: boolean) => {
    const current = dragRef.current;
    const target = slotRef.current;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    dragRef.current = null;
    slotRef.current = null;
    setDrag(null);
    setSlot(null);
    if (!commit || !current || !target) return;
    const next = moveCard(table, group, current.row, target.lane, target.index, (raw) => typed(group, raw));
    if (next !== table) onTable(next);
  };

  useEffect(() => {
    if (!drag) return;
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      stop(false);
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  });

  useLayoutEffect(() => {
    if (drag) placeGhost();
  }, [drag]);

  const startDrag = (row: number) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const card = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;
    const move = (moved: PointerEvent) => {
      pointer.current = { x: moved.clientX, y: moved.clientY };
      if (!started && Math.hypot(moved.clientX - startX, moved.clientY - startY) < DRAG_THRESHOLD_PX) return;
      if (!started) {
        started = true;
        const box = card.getBoundingClientRect();
        const next = { row, width: box.width, height: box.height, grabX: startX - box.left, grabY: startY - box.top };
        dragRef.current = next;
        slotRef.current = slotAt(moved.clientX, moved.clientY, row);
        setSlot(slotRef.current);
        setDrag(next);
        return;
      }
      if (!frame.current) frame.current = requestAnimationFrame(placeGhost);
    };
    const end = (ended: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (started) stop(ended.type === "pointerup");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  const rename = (row: number, title: string) => {
    if (title === (table.rows[row]?.[0]?.raw ?? "")) return;
    onTable(withCell(table, row, 0, typed(0, title)));
  };

  const addCard = (lane: string, title: string) => {
    const cells = emptyRow(table).map((cell, c) => (c === 0 ? typed(0, title) : c === group ? typed(group, lane) : cell));
    onTable({ ...table, rows: [...table.rows, cells] });
  };

  const addLane = (name: string) => {
    if (lanes.some((lane) => lane.value === name)) return;
    onLayout({ ...layout, lanes: [...lanes.map((lane) => lane.value).filter(Boolean), name] });
  };

  const renderLane = (lane: Lane) => {
    const visible = drag ? lane.rows.filter((row) => row !== drag.row) : lane.rows;
    const open = drag && slot?.lane === lane.value ? slot.index : -1;
    const items = visible.map((row) => <Card key={row} table={table} row={row} group={group} onPointerDown={startDrag(row)} onRename={(title) => rename(row, title)} />);
    if (open >= 0) items.splice(open, 0, <div key="slot" className="kertas-card-slot" style={{ height: drag?.height }} />);
    return (
      <section key={lane.value || "∅"} className={`kertas-lane${open >= 0 ? " kertas-lane-target" : ""}`} data-lane={lane.value}>
        <header>
          <span className="kertas-lane-name">{lane.value || "Sans statut"}</span>
          <span className="kertas-lane-count">{lane.rows.length}</span>
        </header>
        <div className="kertas-lane-cards">{items}</div>
        {lane.value !== "" && <AddCard onAdd={(title) => addCard(lane.value, title)} />}
      </section>
    );
  };

  return (
    <div ref={board} className={`kertas-board${drag ? " kertas-board-dragging" : ""}`} onDragStart={(event) => event.preventDefault()}>
      {lanes.map(renderLane)}
      <AddLane onAdd={addLane} />
      {drag &&
        createPortal(
          <div ref={ghost} className="kertas-card-ghost" style={{ width: drag.width }}>
            <Card table={table} row={drag.row} group={group} />
          </div>,
          document.body,
        )}
    </div>
  );
}
