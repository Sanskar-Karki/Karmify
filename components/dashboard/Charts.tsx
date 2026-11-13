"use client";

// Kept in its own module so the dashboard can load the large charting library
// separately and show its numbers first.

import {
  ResponsiveContainer, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, BarChart, Bar, Cell, PieChart, Pie, Legend,
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
const CATEGORY_COLORS = ["#CB2957", "#8B1A38", "#E8699A", "#F4A6BE"];

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

export function DeliveryPieChart({ data }: { data: { key: string; name: string; color: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={6} dataKey="value">
          {data.map(entry => (
            <Cell key={entry.key} fill={entry.color} />
          ))}
        </Pie>
        <RechartsTooltip contentStyle={TOOLTIP_STYLE} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function OrderTrendChart({ data, tickInterval }: { data: { label: string; created: number; delivered: number; returned: number }[]; tickInterval: number }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={2} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke={GRID_COLOR} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval={tickInterval} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
        <RechartsTooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#8888881a" }} />
        <Legend wrapperStyle={{ fontSize: "10px" }} iconType="square" />
        <Bar dataKey="created" name="Created" fill="#CB2957" radius={[4, 4, 0, 0]} maxBarSize={16} />
        <Bar dataKey="delivered" name="Delivered" fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={16} />
        <Bar dataKey="returned" name="Returned" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CategoryBarChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_COLOR} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} />
        <RechartsTooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey="value" fill="#CB2957" radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={CATEGORY_COLORS[(index + 1) % CATEGORY_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
