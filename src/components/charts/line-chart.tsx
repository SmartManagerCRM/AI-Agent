"use client";

import { useState } from "react";

import { formatMoney } from "@/lib/money";

type Point = { date: string; count: number };

/**
 * A serializable description of how to format a chart value — never a
 * function. Passing a closure from a Server Component page into this
 * Client Component isn't valid (functions can't cross the RSC boundary
 * unless they're a real Server Action), so formatting math lives here
 * instead, driven by these plain values the server can safely hand down.
 */
export type ChartValueFormat = { kind: "number" } | { kind: "currency"; currency: string; exponent: number; locale: string };

function formatPoint(value: number, format: ChartValueFormat): string {
  return format.kind === "currency" ? formatMoney(value, format.currency, format.exponent, format.locale) : String(value);
}

const WIDTH = 640;
const HEIGHT = 220;
const PADDING = { top: 16, right: 16, bottom: 24, left: 32 };

/**
 * Single-series line chart — dataviz skill mark spec: 2px line, rounded
 * caps, recessive axes, hover crosshair + tooltip. One series needs no
 * legend (the title/label names it). Shared by the Super Admin overview
 * (business signups) and the tenant dashboard (sales over time).
 */
export function LineChart({
  data,
  label,
  format = { kind: "number" },
}: {
  data: Point[];
  label: string;
  /** How to render both the tooltip value and the axis min/max labels. */
  format?: ChartValueFormat;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const maxValue = Math.max(1, ...data.map((point) => point.count));

  const x = (index: number) => PADDING.left + (index / Math.max(1, data.length - 1)) * innerWidth;
  const y = (value: number) => PADDING.top + innerHeight - (value / maxValue) * innerHeight;

  const linePath = data.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.count)}`).join(" ");
  const areaPath = `${linePath} L ${x(data.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`;

  const hovered = hoverIndex !== null ? data[hoverIndex] : null;

  return (
    <div className="viz-root relative">
      <style>{`
        .viz-root {
          --series-1: #2a78d6;
          --text-secondary: #737373;
          --grid: #e5e5e5;
        }
      `}</style>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const relativeX = ((event.clientX - rect.left) / rect.width) * WIDTH;
          const index = Math.round(((relativeX - PADDING.left) / innerWidth) * (data.length - 1));
          setHoverIndex(Math.min(data.length - 1, Math.max(0, index)));
        }}
      >
        <line
          x1={PADDING.left}
          y1={PADDING.top + innerHeight}
          x2={WIDTH - PADDING.right}
          y2={PADDING.top + innerHeight}
          stroke="var(--grid)"
        />
        <text x={PADDING.left} y={PADDING.top - 2} fontSize="11" fill="var(--text-secondary)">
          {formatPoint(maxValue, format)}
        </text>
        <text x={PADDING.left} y={HEIGHT - 6} fontSize="11" fill="var(--text-secondary)">
          {formatPoint(0, format)}
        </text>
        <path d={areaPath} fill="var(--series-1)" opacity={0.08} stroke="none" />
        <path d={linePath} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {hovered && (
          <>
            <line
              x1={x(hoverIndex ?? 0)}
              y1={PADDING.top}
              x2={x(hoverIndex ?? 0)}
              y2={PADDING.top + innerHeight}
              stroke="var(--grid)"
            />
            <circle cx={x(hoverIndex ?? 0)} cy={y(hovered.count)} r={4} fill="var(--series-1)" />
          </>
        )}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs shadow-sm"
          style={{
            left: `${(x(hoverIndex ?? 0) / WIDTH) * 100}%`,
            top: 0,
            transform: "translate(-50%, -100%)",
          }}
        >
          <p className="font-medium text-neutral-900">{hovered.date}</p>
          <p className="text-neutral-500">
            {label}: {formatPoint(hovered.count, format)}
          </p>
        </div>
      )}
      <div className="mt-1 flex justify-between text-xs text-neutral-500">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}
