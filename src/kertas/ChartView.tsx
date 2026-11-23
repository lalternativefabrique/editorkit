import { useState } from "react";

import type { Chart, ChartAxes, Column, PropertyType } from "./types";

const MEASURES: PropertyType["type"][] = ["number", "money", "percent"];
const COLUMN_HEIGHT_PX = 160;
const MAX_TIME_VALUE_LABELS = 8;

const isMeasure = (column: Column) => MEASURES.includes(column.property.type);

function share(value: number, max: number): number {
  return max > 0 ? Math.max(0, value) / max : 0;
}

function shortDate(label: string): string {
  const [day, month] = label.split("/");
  return day && month ? `${day}/${month}` : label;
}

function AxisPicker({
  columns,
  axes,
  onChange,
  onRemove,
}: {
  columns: Column[];
  axes: ChartAxes;
  onChange: (axes: ChartAxes) => void;
  onRemove: () => void;
}) {
  const options = (keep: (column: Column) => boolean) =>
    columns.map((column, index) => ({ column, index })).filter(({ column }) => keep(column));
  return (
    <div className="kertas-chart-controls">
      <label>
        Par
        <select value={axes.x} onChange={(event) => onChange({ ...axes, x: Number(event.target.value) })}>
          {options((column) => !isMeasure(column)).map(({ column, index }) => (
            <option key={index} value={index}>
              {column.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Valeur
        <select value={axes.y} onChange={(event) => onChange({ ...axes, y: Number(event.target.value) })}>
          {options(isMeasure).map(({ column, index }) => (
            <option key={index} value={index}>
              {column.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="kertas-chart-remove" onClick={onRemove} title="Retirer le graphique">
        ×
      </button>
    </div>
  );
}

function CategoryBars({ chart }: { chart: Chart }) {
  const max = Math.max(...chart.points.map((p) => p.value), 0);
  return (
    <div className="kertas-bars" role="list">
      {chart.points.map((point) => (
        <div key={point.label} className="kertas-bar-row" role="listitem" title={`${point.label} · ${point.display}`}>
          <span className="kertas-bar-label">{point.label}</span>
          <span className="kertas-bar-track">
            <span className="kertas-bar" style={{ width: `calc((100% - 7em) * ${share(point.value, max)})` }} />
            <span className="kertas-bar-value">{point.display}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function TimeColumns({ chart }: { chart: Chart }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(...chart.points.map((p) => p.value), 0);
  const labelled = chart.points.length <= MAX_TIME_VALUE_LABELS;
  return (
    <div className="kertas-columns" style={{ height: COLUMN_HEIGHT_PX }} onMouseLeave={() => setHovered(null)}>
      {chart.points.map((point, index) => (
        <div
          key={point.label}
          className="kertas-column-slot"
          onMouseEnter={() => setHovered(index)}
          aria-label={`${point.label} : ${point.display}`}
        >
          {(labelled || hovered === index) && (
            <span className="kertas-column-value" style={{ bottom: `${share(point.value, max) * 100}%` }}>
              {point.display}
            </span>
          )}
          <span className="kertas-column" style={{ height: `${share(point.value, max) * 100}%` }} />
          <span className="kertas-column-label">{shortDate(point.label)}</span>
          {hovered === index && !labelled && (
            <span className="kertas-chart-tooltip">
              {point.label} · {point.display}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function ChartView({
  chart,
  columns,
  axes,
  onChange,
  onRemove,
}: {
  chart: Chart | null;
  columns: Column[];
  axes: ChartAxes;
  onChange: (axes: ChartAxes) => void;
  onRemove: () => void;
}) {
  return (
    <figure className="kertas-chart">
      <figcaption>
        <span className="kertas-chart-title">{chart?.title ?? "Graphique"}</span>
        <AxisPicker columns={columns} axes={axes} onChange={onChange} onRemove={onRemove} />
      </figcaption>
      {!chart || chart.points.length === 0 ? (
        <p className="kertas-chart-empty">Pas de valeur à représenter pour ces colonnes.</p>
      ) : chart.axis === "time" ? (
        <TimeColumns chart={chart} />
      ) : (
        <CategoryBars chart={chart} />
      )}
    </figure>
  );
}
