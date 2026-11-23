import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { Kertas } from "./engine";
import { addDays, daysBetween, isDone, rawDate, timeline, type Bar } from "./layouts";
import type { Table } from "./types";

const ZOOMS = { fit: 0, day: 32, week: 12 } as const;
const ZOOM_LABELS: Record<keyof typeof ZOOMS, string> = { fit: "Ajusté", day: "Jours", week: "Semaines" };
const MIN_FIT_PX = 10;
const DAY_NUMBERS_PX = 22;
const LABEL_PX = 200;
const ROW_PX = 36;
const EDGE_PX = 40;
const EDGE_SPEED = 12;
const DRAG_THRESHOLD_PX = 3;

type Zoom = keyof typeof ZOOMS;
type Grip = "move" | "start" | "end";

const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const SHORT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const dayOfMonth = (iso: string) => Number(iso.slice(8, 10));
const weekday = (iso: string) => asDate(iso).getUTCDay();
const short = (iso: string) => SHORT.format(asDate(iso));
const MONTH_LABEL_MIN_PX = 64;
const TEXT_INSIDE_PX = 8;

function span(from: string, to: string): string {
  if (from === to) return short(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${dayOfMonth(from)}–${short(to)}`;
  return `${short(from)} – ${short(to)}`;
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function months(from: string, days: number): { label: string; offset: number; length: number }[] {
  const result: { label: string; offset: number; length: number }[] = [];
  for (let d = 0; d < days; d++) {
    const iso = addDays(from, d);
    if (d === 0 || dayOfMonth(iso) === 1) result.push({ label: MONTH.format(asDate(iso)), offset: d, length: 0 });
    result[result.length - 1].length++;
  }
  return result;
}

interface Preview {
  row: number;
  from: string;
  to: string;
}

export function TimelineView({
  engine,
  table,
  start,
  end,
  group,
  onTable,
}: {
  engine: Kertas;
  table: Table;
  start: number;
  end: number | undefined;
  group: number | null;
  onTable: (next: Table) => void;
}) {
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [room, setRoom] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const today = todayIso();
  const { from, days, bars } = useMemo(() => timeline(table, start, end, today), [table, start, end, today]);
  const width = zoom === "fit" ? Math.max(MIN_FIT_PX, room > 0 ? Math.floor((room - LABEL_PX) / days) : ZOOMS.day) : ZOOMS[zoom];
  const monthBands = useMemo(() => months(from, days), [from, days]);
  const pending = useRef<{ frame: number; next: Preview | null }>({ frame: 0, next: null });

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setRoom(el.clientWidth);
    const observer = new ResizeObserver(() => setRoom(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (zoom === "fit") return;
    const first = bars.find((bar): bar is Bar => bar !== null);
    if (!el || !first) return;
    el.scrollLeft = Math.max(0, (daysBetween(from, first.from) - 1) * width);
  }, [zoom]);

  useEffect(() => () => cancelAnimationFrame(pending.current.frame), []);

  const schedule = (next: Preview) => {
    pending.current.next = next;
    if (pending.current.frame) return;
    pending.current.frame = requestAnimationFrame(() => {
      pending.current.frame = 0;
      setPreview(pending.current.next);
    });
  };

  const write = (row: number, next: { from: string; to: string }) => {
    const date = { type: "date" } as const;
    const [fromValue, toValue] = engine.typeValues([rawDate(next.from), rawDate(next.to)], date);
    const rows = table.rows.map((cells, r) =>
      r !== row ? cells : cells.map((cell, c) => (c === start ? fromValue : c === end ? toValue : cell)),
    );
    onTable({ ...table, rows });
  };

  const grab = (bar: Bar, grip: Grip) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const el = scroller.current;
    const startX = event.clientX;
    const startScroll = el?.scrollLeft ?? 0;
    let lastX = startX;
    let latest: Preview = { row: bar.row, from: bar.from, to: bar.to };
    let moved = false;
    let edgeFrame = 0;
    handle.setPointerCapture(event.pointerId);

    const update = () => {
      const shift = Math.round((lastX - startX + (el?.scrollLeft ?? 0) - startScroll) / width);
      const length = daysBetween(bar.from, bar.to);
      if (grip === "move") latest = { row: bar.row, from: addDays(bar.from, shift), to: addDays(bar.to, shift) };
      else if (grip === "start") latest = { row: bar.row, from: addDays(bar.from, Math.min(shift, length)), to: bar.to };
      else latest = { row: bar.row, from: bar.from, to: addDays(bar.to, Math.max(shift, -length)) };
      schedule(latest);
    };
    const edge = () => {
      edgeFrame = 0;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const step = lastX < box.left + LABEL_PX + EDGE_PX ? -EDGE_SPEED : lastX > box.right - EDGE_PX ? EDGE_SPEED : 0;
      if (step === 0) return;
      el.scrollLeft += step;
      update();
      edgeFrame = requestAnimationFrame(edge);
    };
    const move = (event: PointerEvent) => {
      lastX = event.clientX;
      if (!moved && Math.abs(lastX - startX) < DRAG_THRESHOLD_PX) return;
      moved = true;
      update();
      if (!edgeFrame) edgeFrame = requestAnimationFrame(edge);
    };
    const finish = (event: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", finish);
      handle.removeEventListener("pointercancel", finish);
      cancelAnimationFrame(edgeFrame);
      cancelAnimationFrame(pending.current.frame);
      pending.current.frame = 0;
      setPreview(null);
      if (moved && event.type === "pointerup" && (latest.from !== bar.from || latest.to !== bar.to)) write(bar.row, latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  };

  const place = (row: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || bars[row]) return;
    const box = event.currentTarget.getBoundingClientRect();
    const iso = addDays(from, Math.floor((event.clientX - box.left) / width));
    write(row, { from: iso, to: iso });
  };

  const todayOffset = daysBetween(from, today);
  const weekendShift = (weekday(from) + 6) % 7;
  const track = days * width;

  return (
    <div className="kertas-timeline" style={{ ["--day" as string]: `${width}px`, ["--label" as string]: `${LABEL_PX}px`, ["--weekend-shift" as string]: `${-weekendShift * width}px` }}>
      <div ref={scroller} className="kertas-timeline-scroll">
        <div className="kertas-timeline-sheet" style={{ width: LABEL_PX + track }}>
          <div className="kertas-timeline-head">
            <div className="kertas-timeline-corner">
              <div className="kertas-timeline-zoom" role="group" aria-label="Échelle">
                {(Object.keys(ZOOMS) as Zoom[]).map((z) => (
                  <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>
                    {ZOOM_LABELS[z]}
                  </button>
                ))}
              </div>
              <span>{table.columns[0]?.name ?? ""}</span>
            </div>
            <div className="kertas-timeline-scale" style={{ width: track }}>
              <div className="kertas-timeline-months">
                {monthBands.map((band) => (
                  <span key={band.offset} style={{ left: band.offset * width, width: band.length * width }}>
                    {band.length * width >= MONTH_LABEL_MIN_PX ? band.label : ""}
                  </span>
                ))}
              </div>
              <div className="kertas-timeline-days">
                {Array.from({ length: days }, (_, d) => {
                  const iso = addDays(from, d);
                  const show = width >= DAY_NUMBERS_PX || weekday(iso) === 1;
                  return (
                    <span key={d} className={`${weekday(iso) % 6 === 0 ? "kertas-weekend" : ""}${d === todayOffset ? " kertas-today" : ""}`} style={{ left: d * width, width }}>
                      {show ? dayOfMonth(iso) : ""}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="kertas-timeline-rows">
            {table.rows.map((cells, row) => {
              const bar = preview?.row === row ? preview : bars[row];
              const done = group !== null && isDone(cells[group]?.raw ?? "");
              return (
                <div key={row} className="kertas-timeline-row" style={{ height: ROW_PX }}>
                  <div className="kertas-timeline-label" title={cells[0]?.display}>
                    {cells[0]?.display || "Sans titre"}
                  </div>
                  <div className="kertas-timeline-track" style={{ width: track }} onPointerDown={place(row)} title={bar ? undefined : "Cliquer pour placer"}>
                    {bar && (() => {
                      const days = daysBetween(bar.from, bar.to) + 1;
                      const text = span(bar.from, bar.to);
                      const milestone = days === 1;
                      const inside = !milestone && days * width >= text.length * TEXT_INSIDE_PX + 32;
                      const source = bars[row] ?? bar;
                      return (
                        <div
                          className={`kertas-timeline-bar${milestone ? " kertas-timeline-milestone" : ""}${done ? " kertas-timeline-bar-done" : ""}${preview?.row === row ? " kertas-timeline-bar-active" : ""}`}
                          style={{ transform: `translateX(${daysBetween(from, bar.from) * width}px)`, width: days * width }}
                          onPointerDown={grab(source, "move")}
                          title={span(bar.from, bar.to)}
                        >
                          {!milestone && end !== undefined && <span className="kertas-timeline-grip kertas-timeline-grip-start" onPointerDown={grab(source, "start")} />}
                          <span className={inside ? "kertas-timeline-bar-text" : "kertas-timeline-bar-aside"}>{text}</span>
                          {end !== undefined && <span className="kertas-timeline-grip kertas-timeline-grip-end" onPointerDown={grab(source, "end")} />}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
            {todayOffset >= 0 && todayOffset < days && <div className="kertas-timeline-now" style={{ left: LABEL_PX + todayOffset * width + width / 2 }} />}
          </div>
        </div>
      </div>
    </div>
  );
}
