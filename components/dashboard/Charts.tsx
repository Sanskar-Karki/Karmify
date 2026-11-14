"use client";

// Kept in its own module so the dashboard can load the large charting library
// separately and show its numbers first.

import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, BarChart, Bar,
} from "recharts";
import { formatNPR } from "@/lib/utils";

const TOOLTIP_STYLE = {
  backgroundColor: "var(--color-card)",
  borderColor: "var(--color-border)",
  color: "var(--color-card-foreground)",
  borderRadius: "0.75rem",
  boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
};

const GRID_COLOR = "#88888820";

export function RevenueChart({ data, tickInterval }: { data: { label: string; amount: number }[]; tickInterval: number }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={tickInterval} />
        <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
        <RechartsTooltip formatter={value => formatNPR(Number(value) || 0)} contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#8888881a" }} />
        <Bar dataKey="amount" name="Revenue" fill="#CB2957" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}
