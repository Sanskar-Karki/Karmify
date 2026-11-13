"use client";

// Sales per day/week/month as bars, the previous period in grey beside them.
// Loaded on its own so the analytics numbers show before the charting library arrives.

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { formatNPR } from "@/lib/utils";
import type { TrendPoint } from "@/lib/analytics";

const PRIMARY = "#CB2957";
const PREVIOUS = "#a1a1aa";

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: TrendPoint }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-foreground">
        <span className="h-2 w-2 rounded-full" style={{ background: PRIMARY }} />
        {formatNPR(point.sales)} <span className="text-muted-foreground">· {point.orders} order{point.orders === 1 ? "" : "s"}</span>
      </p>
      {point.previous !== null && (
        <p className="mt-0.5 flex items-center gap-2 text-muted-foreground">
          <span className="h-2 w-2 rounded-full" style={{ background: PREVIOUS }} />
          Previous: {formatNPR(point.previous)}
        </p>
      )}
    </div>
  );
}

export default function SalesTrendChart({ data }: { data: TrendPoint[] }) {
  const hasPrevious = data.some(d => d.previous !== null);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="#88888822" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} tick={{ fontSize: 11, fill: "currentColor" }} className="text-muted-foreground" />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          tick={{ fontSize: 11, fill: "currentColor" }}
          className="text-muted-foreground"
          tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))}
        />
        <Tooltip content={<TrendTooltip />} cursor={{ fill: "#8888881a" }} />
        {/* The previous period sits beside each bar, in grey, for comparison. */}
        {hasPrevious && <Bar dataKey="previous" fill={PREVIOUS} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />}
        <Bar dataKey="sales" fill={PRIMARY} radius={[4, 4, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}
