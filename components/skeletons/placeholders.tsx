import React from "react";
import { Pulse } from "@/components/shared/Pulse";
import { cn } from "@/lib/utils";

// Placeholders shaped like the content they stand in for: real headings and
// column names stay readable, and only the values from the database shimmer.
// The route-level loading screens and the pages share these, so the layout
// doesn't jump when one hands over to the other.

const WIDTHS = ["w-3/4", "w-1/2", "w-5/6", "w-2/3"];
const card = "bg-card border border-border/80 rounded-2xl shadow-sm";

function Lines({ first, second, end }: { first: string; second: string; end?: boolean }) {
  return (
    <div className={cn("space-y-1.5", end && "flex flex-col items-end")}>
      <Pulse className={cn("h-3", first)} />
      <Pulse className={cn("h-2.5", second)} />
    </div>
  );
}

const Pill = ({ className }: { className?: string }) => <Pulse className={cn("h-5 w-16 rounded-full", className)} />;

function IconAndLines({ width, size = "w-9 h-9" }: { width: string; size?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Pulse className={cn("rounded-xl shrink-0", size)} />
      <div className="flex-1 min-w-0"><Lines first={width} second="w-20" /></div>
    </div>
  );
}

export type PlaceholderColumn = {
  label: string;
  /** Alignment and responsive visibility, matching the real column. */
  className?: string;
  cell: (width: string) => React.ReactNode;
};

/** Table rows for a page's own `<tbody>`, while its real rows are on their way. */
export function PlaceholderRows({ columns, rows = 6, cellClassName = "px-5 py-3.5" }: { columns: PlaceholderColumn[]; rows?: number; cellClassName?: string }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} aria-hidden="true">
          {columns.map((column, i) => (
            <td key={i} className={cn(cellClassName, column.className)}>{column.cell(WIDTHS[(row + i) % WIDTHS.length])}</td>
          ))}
        </tr>
      ))}
    </>
  );
}

function PlaceholderTable({ columns, rows, cellClassName }: { columns: PlaceholderColumn[]; rows?: number; cellClassName?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/60 bg-muted/30">
            {columns.map((column, i) => (
              <th key={i} className={cn("text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-5 py-3", column.className)}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          <PlaceholderRows columns={columns} rows={rows} cellClassName={cellClassName} />
        </tbody>
      </table>
    </div>
  );
}

export const ORDER_COLUMNS: PlaceholderColumn[] = [
  { label: "", cell: () => <Pulse className="h-4 w-4" /> },
  { label: "SN", className: "hidden sm:table-cell", cell: () => <Pulse className="h-3 w-4" /> },
  { label: "Date", className: "hidden md:table-cell", cell: () => <Pulse className="h-3 w-16" /> },
  { label: "Order ID", cell: () => <Pulse className="h-3 w-32" /> },
  { label: "Customer", cell: width => <div className="space-y-1.5"><Lines first={width} second="w-16" /><Pulse className="h-2.5 w-20 lg:hidden" /></div> },
  { label: "Phone", className: "hidden lg:table-cell", cell: () => <Lines first="w-20" second="w-24" /> },
  { label: "COD Amount", className: "text-right", cell: () => <Pulse className="h-3 w-16 ml-auto" /> },
  { label: "Delivery Amount", className: "text-right hidden lg:table-cell", cell: () => <Pulse className="h-3 w-14 ml-auto" /> },
  { label: "Status", className: "hidden sm:table-cell", cell: () => <Pill /> },
  { label: "Action", className: "text-right", cell: () => <div className="flex justify-end gap-1.5"><Pulse className="w-8 h-8 rounded-lg" /><Pulse className="w-8 h-8 rounded-lg hidden sm:block" /><Pulse className="w-8 h-8 rounded-lg" /></div> },
];

export const PRODUCT_COLUMNS: PlaceholderColumn[] = [
  {
    label: "Product",
    cell: width => (
      <div className="space-y-1.5">
        <IconAndLines width={width} />
        <div className="flex gap-1.5 pl-12 md:hidden"><Pulse className="h-4 w-14" /><Pulse className="h-4 w-14" /></div>
      </div>
    ),
  },
  { label: "Category", className: "hidden md:table-cell", cell: () => <Pulse className="h-6 w-20 rounded-lg" /> },
  { label: "Supplier", className: "hidden lg:table-cell", cell: () => <Pulse className="h-3 w-24" /> },
  { label: "Price", className: "text-right", cell: () => <Lines first="w-16" second="w-28" end /> },
  { label: "Stock", className: "text-right hidden md:table-cell", cell: () => <Pulse className="h-6 w-20 rounded-lg ml-auto" /> },
  { label: "Status", className: "text-center", cell: () => <Pill className="mx-auto" /> },
  { label: "", cell: () => null },
];

export const STOCK_COLUMNS: PlaceholderColumn[] = [
  { label: "Product", cell: width => <IconAndLines width={width} size="w-8 h-8" /> },
  { label: "Min Level", cell: () => <Pulse className="h-3 w-14" /> },
  { label: "Total", className: "text-right", cell: () => <Pulse className="h-4 w-8 ml-auto" /> },
  { label: "Health", className: "text-center", cell: () => <Pill className="w-12 mx-auto" /> },
];

export const MOVEMENT_COLUMNS: PlaceholderColumn[] = [
  { label: "Type", cell: () => <Pulse className="h-6 w-20 rounded-lg" /> },
  { label: "Product", cell: width => <Lines first={width} second="w-16" /> },
  { label: "Qty", className: "text-right", cell: () => <Pulse className="h-4 w-6 ml-auto" /> },
  { label: "Notes", className: "hidden lg:table-cell", cell: width => <Pulse className={cn("h-2.5", width)} /> },
  { label: "Date", className: "text-right", cell: () => <Pulse className="h-2.5 w-12 ml-auto" /> },
];

export function ProductCardPlaceholder() {
  return (
    <div aria-hidden="true" className="flex flex-col items-start gap-2 p-4 bg-card border border-border/40 rounded-2xl">
      <Pulse className="w-10 h-10 rounded-xl" />
      <div className="w-full"><Lines first="w-5/6" second="w-1/2" /></div>
      <div className="flex items-end justify-between w-full mt-auto gap-1">
        <Pulse className="h-4 w-16" />
        <Pulse className="h-4 w-10" />
      </div>
    </div>
  );
}

export function TransactionRowPlaceholder() {
  return (
    <div aria-hidden="true" className="flex items-center justify-between gap-3 px-4 py-3">
      <Lines first="w-32" second="w-24" />
      <Lines first="w-14" second="w-10" end />
    </div>
  );
}

export function PurchaseOrderPlaceholder() {
  return (
    <div aria-hidden="true" className={cn(card, "flex flex-col md:flex-row md:items-center justify-between gap-3 p-5")}>
      <div className="flex items-center gap-4 min-w-0">
        <Pulse className="w-10 h-10 rounded-xl shrink-0" />
        <div className="space-y-2">
          <div className="flex items-center gap-2.5"><Pulse className="h-3.5 w-32" /><Pill className="w-14" /><Pill className="w-12" /></div>
          <Pulse className="h-2.5 w-40" />
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <Pulse className="h-5 w-24" />
        <Pulse className="h-8 w-28 rounded-xl" />
      </div>
    </div>
  );
}

export function SupplierRowPlaceholder() {
  return (
    <div aria-hidden="true" className="flex items-center gap-4 px-5 sm:px-6 py-4">
      <div className="flex-1 min-w-0"><Lines first="w-40" second="w-64 max-w-full" /></div>
      <div className="flex gap-1 shrink-0"><Pulse className="w-8 h-8 rounded-lg" /><Pulse className="w-8 h-8 rounded-lg" /></div>
    </div>
  );
}

export function LowStockRowPlaceholder() {
  return (
    <div aria-hidden="true" className="flex items-center gap-3 p-3 border border-border/40 rounded-xl">
      <Pulse className="w-8 h-8 rounded-lg shrink-0" />
      <div className="flex-1 min-w-0"><Lines first="w-2/3" second="w-20" /></div>
      <Pulse className="h-4 w-16 shrink-0" />
    </div>
  );
}

export function ActivityRowPlaceholder() {
  return (
    <div aria-hidden="true" className="flex gap-4 items-start border-b border-border/30 pb-3 last:border-0 last:pb-0">
      <Pulse className="w-6 h-6 rounded-lg shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0"><Lines first="w-32" second="w-3/4" /></div>
      <Pulse className="h-2.5 w-12 shrink-0" />
    </div>
  );
}

const CHART_BARS = [38, 62, 45, 78, 54, 88, 66, 42, 72, 58, 83, 49];

/** Bars on faint gridlines, so a chart area reads as a chart while it loads. */
export function ChartPlaceholder() {
  return (
    <div aria-hidden="true" className="relative h-full w-full flex items-end gap-1.5 sm:gap-3 pl-1 pb-5">
      <div className="absolute inset-0 bottom-5 flex flex-col justify-between">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="border-t border-border/40" />)}
      </div>
      {CHART_BARS.map((height, i) => <Pulse key={i} className="relative flex-1 rounded-t-md rounded-b-none" style={{ height: `${height}%` }} />)}
    </div>
  );
}

function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
      <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
    </div>
  );
}

function StatCards({ labels, valueClassName = "h-9" }: { labels: string[]; valueClassName?: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {labels.map(label => (
        <div key={label} className={cn(card, "p-5")}>
          <p className="text-xs font-semibold text-muted-foreground">{label}</p>
          <Pulse className={cn("w-20 mt-1", valueClassName)} />
        </div>
      ))}
    </div>
  );
}

function CardTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-base font-bold text-foreground">{title}</h2>
      <p className="text-[11px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}

const Loading = ({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) => (
  <div role="status" aria-label={label} aria-busy="true" className={cn("space-y-5", className)}>{children}</div>
);

export function DashboardPlaceholder() {
  return (
    <Loading label="Loading dashboard">
      {/* Greeting + quick actions */}
      <div className={cn(card, "flex flex-col gap-4 p-5 sm:p-6 md:flex-row md:items-center md:justify-between")}>
        <div className="space-y-2">
          <Pulse className="h-2.5 w-36" />
          <Pulse className="h-6 w-56" />
          <Pulse className="h-3 w-48" />
        </div>
        <div className="flex flex-wrap gap-2">
          {["w-24", "w-20", "w-28", "w-24"].map((w, i) => <Pulse key={i} className={cn("h-8 rounded-xl", w)} />)}
        </div>
      </div>

      {/* Today at a glance */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {["Sales today", "Orders today", "This month", "COD still to collect"].map(label => (
          <div key={label} className={cn(card, "p-5")}>
            <div className="flex items-start justify-between">
              <span className="text-xs font-semibold text-muted-foreground">{label}</span>
              <Pulse className="h-8 w-8 rounded-lg" />
            </div>
            <Pulse className="mt-1 h-8 w-28" />
            <Pulse className="mt-2 h-4 w-36" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={cn(card, "p-5 sm:p-6")}>
          <h2 className="mb-3 text-base font-bold text-foreground">Needs attention</h2>
          <div className="space-y-1">
            {WIDTHS.concat(WIDTHS.slice(0, 2)).map((w, i) => (
              <div key={i} className="flex items-center gap-3 px-2.5 py-2.5">
                <Pulse className="h-9 w-9 shrink-0 rounded-lg" />
                <div className="flex-1"><Lines first={w} second="w-1/2" /></div>
                <Pulse className="h-6 w-8 rounded-md" />
              </div>
            ))}
          </div>
        </div>
        <div className={cn(card, "space-y-4 p-5 sm:p-6 lg:col-span-2")}>
          <div className="flex items-start justify-between gap-3">
            <CardTitle title="Sales" subtitle="Cancelled orders left out" />
            <Pulse className="h-8 w-56 max-w-[50%] rounded-lg" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {["Revenue", "Orders", "Average order"].map(label => (
              <div key={label} className="rounded-xl bg-muted/40 px-3 py-2.5">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <Pulse className="mt-1 h-5 w-16" />
              </div>
            ))}
          </div>
          <div className="h-60"><ChartPlaceholder /></div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {["Where orders are", "Best sellers", "Low stock"].map(title => (
          <div key={title} className={cn(card, "space-y-4 p-5 sm:p-6")}>
            <h2 className="text-base font-bold text-foreground">{title}</h2>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between"><Pulse className={cn("h-3", WIDTHS[i])} /><Pulse className="h-3 w-8" /></div>
                {title === "Where orders are" && <Pulse className="h-2 w-full rounded-full" />}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Loading>
  );
}

export function ProductsPlaceholder() {
  return (
    <Loading label="Loading products">
      <PageHeading title="Product Catalog" subtitle="All your SKUs across every category" />
      <Pulse className="h-10 w-full rounded-xl" />
      <div className={cn(card, "overflow-hidden")}><PlaceholderTable columns={PRODUCT_COLUMNS} cellClassName="px-5 py-4" /></div>
    </Loading>
  );
}

export function InventoryPlaceholder() {
  return (
    <Loading label="Loading inventory">
      <PageHeading title="Inventory & Stock Hub" subtitle="Track and audit stock for your store" />
      <div className={cn(card, "overflow-hidden")}>
        <div className="p-5 border-b border-border/60">
          <h2 className="font-bold text-base">Stock Levels</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">Current physical unit counts</p>
        </div>
        <PlaceholderTable columns={STOCK_COLUMNS} rows={8} cellClassName="px-5 py-4" />
      </div>
    </Loading>
  );
}

export function SalesPlaceholder() {
  return (
    <Loading label="Loading point of sale">
      <PageHeading title="POS & Sales Terminal" subtitle="Checkout counter & live billing station" />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-7 space-y-3">
          <Pulse className="h-10 w-full rounded-xl" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Array.from({ length: 6 }, (_, i) => <ProductCardPlaceholder key={i} />)}
          </div>
        </div>
        <div className={cn(card, "lg:col-span-5 p-4 space-y-3")}>
          <h2 className="font-bold text-sm">Cart</h2>
          {Array.from({ length: 3 }, (_, i) => <Pulse key={i} className="h-9 w-full rounded-xl" />)}
          <Pulse className="h-24 w-full rounded-xl" />
          <Pulse className="h-11 w-full rounded-xl" />
        </div>
      </div>
    </Loading>
  );
}

export function PurchasesPlaceholder() {
  return (
    <Loading label="Loading purchase orders">
      <PageHeading title="Purchase Orders" subtitle="Manage supplier restocking orders & receiving" />
      <StatCards labels={["Total Orders", "Pending", "Completed"]} />
      <div className="space-y-3">{Array.from({ length: 4 }, (_, i) => <PurchaseOrderPlaceholder key={i} />)}</div>
    </Loading>
  );
}

export function CustomersPlaceholder() {
  return (
    <Loading label="Loading orders">
      {/* Title with its one-line summary, and the toolbar */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight">Customers &amp; Orders</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
            {["orders", "revenue", "to deliver", "unpaid"].map(label => (
              <span key={label} className="flex items-center gap-1.5"><Pulse className="h-3.5 w-10" />{label}</span>
            ))}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto">
          <Pulse className="h-9 min-w-full flex-1 rounded-lg sm:min-w-56 xl:w-64 xl:flex-none" />
          {["w-20", "w-28", "w-28", "w-24"].map((w, i) => <Pulse key={i} className={cn("h-9 flex-1 rounded-lg sm:flex-none", w)} />)}
        </div>
      </div>
      {/* Status chips and filters */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <Pulse className="h-9 w-full max-w-xl rounded-xl" />
        <div className="flex gap-1.5">{["w-32", "w-36", "w-32"].map((w, i) => <Pulse key={i} className={cn("h-8 rounded-lg", w)} />)}</div>
      </div>
      <div className={cn(card, "overflow-hidden")}><PlaceholderTable columns={ORDER_COLUMNS} /></div>
    </Loading>
  );
}

/** The Upaya page: title, the five totals, the step boxes and the list. */
export function UpayaPlaceholder() {
  return (
    <Loading label="Loading Upaya orders">
      <div className="space-y-2">
        <Pulse className="h-2.5 w-40" />
        <Pulse className="h-6 w-48" />
        <Pulse className="h-3 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => <Pulse key={i} className={cn("h-[86px] rounded-2xl", i === 0 && "col-span-2 sm:col-span-1")} />)}
      </div>
      <div className={cn(card, "grid grid-cols-2 gap-2 p-2.5 sm:grid-cols-3 lg:grid-cols-5")}>
        {Array.from({ length: 10 }, (_, i) => <Pulse key={i} className="h-[62px] rounded-xl" />)}
      </div>
      <div className={cn(card, "space-y-2 p-3")}>
        {Array.from({ length: 5 }, (_, i) => <Pulse key={i} className="h-14 w-full rounded-xl" />)}
      </div>
    </Loading>
  );
}

export function CustomerDetailPlaceholder() {
  return (
    <Loading label="Loading customer">
      <div className="flex items-center gap-3">
        <Pulse className="h-9 w-9 shrink-0 rounded-xl" />
        <Pulse className="h-3 w-48" />
      </div>
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* Profile */}
        <div className="space-y-4">
          <div className={cn(card, "overflow-hidden")}>
            <div className="flex items-start gap-4 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5">
              <Pulse className="h-14 w-14 shrink-0 rounded-2xl" />
              <div className="flex-1 space-y-2">
                <Pulse className="h-5 w-40" />
                <Pulse className="h-4 w-24 rounded-md" />
                <Pulse className="h-2.5 w-32" />
              </div>
            </div>
            <div className="space-y-3 border-t border-border/60 p-5">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Contact</p>
              {["Phone", "Address"].map(label => (
                <div key={label} className="flex items-start gap-3">
                  <Pulse className="h-8 w-8 shrink-0 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <Pulse className="h-3.5 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className={cn(card, "grid grid-cols-2 gap-px overflow-hidden bg-border/60")}>
            {["Orders", "Spent", "Average order", "Last order", "Returns", "Unpaid"].map(label => (
              <div key={label} className="bg-card p-3.5">
                <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
                <Pulse className="mt-1 h-5 w-16" />
              </div>
            ))}
          </div>
        </div>

        {/* Orders */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold">Orders</h2>
            <div className="flex gap-1.5">{["w-12", "w-20", "w-16"].map(w => <Pulse key={w} className={cn("h-6 rounded-full", w)} />)}</div>
          </div>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={cn(card, "overflow-hidden")}>
              <div className="flex items-start justify-between gap-4 p-4 sm:p-5">
                <div className="flex-1"><IconAndLines width="w-32" size="h-10 w-10" /></div>
                <Lines first="w-20" second="w-14" end />
              </div>
              <div className="flex items-center justify-between border-y border-border/50 bg-muted/30 px-4 py-2.5 sm:px-5">
                <Pulse className="h-8 w-44 rounded-lg" />
                <div className="flex gap-1.5"><Pulse className="h-8 w-8 rounded-lg" /><Pulse className="h-8 w-8 rounded-lg" /><Pulse className="h-8 w-14 rounded-lg" /></div>
              </div>
              <div className="space-y-2 p-4 sm:p-5">
                <div className="flex justify-between"><Pulse className={cn("h-3", WIDTHS[i])} /><Pulse className="h-3 w-14" /></div>
                <Pulse className="h-2.5 w-28" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Loading>
  );
}

export function SettingsPlaceholder() {
  return (
    <Loading label="Loading settings" className="max-w-5xl">
      <PageHeading title="Settings" subtitle="Manage your store profile, suppliers and team" />
      <Pulse className="h-11 w-72 max-w-full rounded-2xl" />
      <div className={cn(card, "p-6 grid grid-cols-1 sm:grid-cols-2 gap-5")}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2"><Pulse className="h-3 w-24" /><Pulse className="h-10 w-full rounded-xl" /></div>
        ))}
      </div>
    </Loading>
  );
}

const ANALYTICS_KPIS = ["Sales", "Orders", "Average order", "Items sold", "Gross profit", "Repeat customers", "Returns", "Awaiting payment"];

/** The Analytics page's numbers, chart and breakdowns while sales load. */
export function AnalyticsBodyPlaceholder() {
  return (
    <div aria-hidden="true" className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ANALYTICS_KPIS.map(label => (
          <div key={label} className={cn(card, "p-5")}>
            <p className="text-xs font-semibold text-muted-foreground">{label}</p>
            <Pulse className="mt-2 h-7 w-24" />
            <Pulse className="mt-2 h-3 w-20" />
          </div>
        ))}
      </div>
      <div className={cn(card, "space-y-3 p-5")}>
        <Pulse className="h-4 w-32" />
        <div className="h-64"><ChartPlaceholder /></div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, n) => (
          <div key={n} className={cn(card, "space-y-3 p-5")}>
            <Pulse className="h-4 w-36" />
            {WIDTHS.map((w, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-between"><Pulse className={cn("h-3", w)} /><Pulse className="h-3 w-12" /></div>
                <Pulse className="h-1.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnalyticsPlaceholder() {
  return (
    <Loading label="Loading analytics">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <PageHeading title="Analytics" subtitle="Sales from the shop and the website" />
        <div className="flex flex-wrap gap-1.5">{["w-14", "w-16", "w-16", "w-20", "w-20"].map((w, i) => <Pulse key={i} className={cn("h-7 rounded-full", w)} />)}</div>
      </div>
      <AnalyticsBodyPlaceholder />
    </Loading>
  );
}
