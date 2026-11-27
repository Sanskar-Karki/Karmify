"use client";

// Kept in its own module so the dashboard can load the large charting library
// separately and show its numbers first.

import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, BarChart, Bar,
} from "recharts";
import { formatNPR } from "@/lib/utils";

const GRID_COLOR = "#88888820";
// Follows the theme: blood red, a little brighter in dark mode.
const PRIMARY = "var(--color-primary)";

export type RevenuePoint = { label: string; amount: number; orders: number };

function RevenueTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: RevenuePoint }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-foreground">
        <span className="h-2 w-2 rounded-full" style={{ background: PRIMARY }} />
        {formatNPR(point.amount)} <span className="text-muted-foreground">· {point.orders} order{point.orders === 1 ? "" : "s"}</span>
      </p>
    </div>
  );
}

export function RevenueChart({ data, tickInterval }: { data: RevenuePoint[]; tickInterval: number }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={tickInterval} />
        <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
        <RechartsTooltip content={<RevenueTooltip />} cursor={{ fill: "#8888881a" }} />
        <Bar dataKey="amount" name="Revenue" fill={PRIMARY} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
