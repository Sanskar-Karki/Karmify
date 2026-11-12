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
              <th key={i} className={cn("text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-5 py-3", column.className)}>{column.label}</th>
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

/** A ring and legend in place of the delivery status breakdown. */
export function DonutPlaceholder() {
  return (
    <div aria-hidden="true">
      <div className="h-44 flex items-center justify-center">
        <Pulse className="w-36 h-36 rounded-full [mask:radial-gradient(circle,transparent_56%,#000_57%)]" />
      </div>
      <div className="space-y-2.5">
        {WIDTHS.map(width => (
          <div key={width} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1"><Pulse className="w-2.5 h-2.5 rounded-full" /><Pulse className={cn("h-3 max-w-28", width)} /></div>
            <Pulse className="h-3 w-6" />
          </div>
        ))}
      </div>
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
      <p className="text-[10px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}

const Loading = ({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) => (
  <div role="status" aria-label={label} aria-busy="true" className={cn("space-y-5", className)}>{children}</div>
);

export function DashboardPlaceholder() {
  return (
    <Loading label="Loading dashboard" className="space-y-6">
      <div className="p-6 bg-card border border-border rounded-2xl">
        <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">Welcome back</h1>
        <p className="text-xs text-muted-foreground mt-1">High-level performance snapshot for your store.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {["Total Sales", "Asset Valuation", "Stock Alerts"].map(label => (
          <div key={label} className="bg-card p-6 border border-border/80 rounded-2xl space-y-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
            <Pulse className="h-8 w-28" />
            <Pill className="w-24 rounded-md" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {["Today's Orders", "In Transit", "Inventory Units", "Products"].map(label => (
          <div key={label} className="bg-card p-4 border border-border/60 rounded-xl">
            <p className="text-xs text-muted-foreground font-semibold mb-2">{label}</p>
            <Pulse className="h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={cn(card, "p-6 lg:col-span-2 space-y-3")}>
          <CardTitle title="Revenue Trend" subtitle="Checkout value over time" />
          <div className="h-64"><ChartPlaceholder /></div>
        </div>
        <div className={cn(card, "p-6")}>
          <CardTitle title="Delivery Status" subtitle="Order fulfillment breakdown" />
          <DonutPlaceholder />
        </div>
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
          <p className="text-[10px] text-muted-foreground mt-0.5">Current physical unit counts</p>
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
      <PageHeading title="Customers & Orders" subtitle="Every order placed, with delivery & payment status" />
      <Pulse className="h-28 w-full rounded-2xl" />
      <StatCards labels={["Total Orders", "Total Revenue", "Pending Deliveries"]} valueClassName="h-8 xl:h-9" />
      <div className={cn(card, "overflow-hidden")}><PlaceholderTable columns={ORDER_COLUMNS} /></div>
    </Loading>
  );
}

export function CustomerDetailPlaceholder() {
  return (
    <Loading label="Loading customer" className="space-y-6">
      <div className="flex items-center gap-3">
        <Pulse className="w-9 h-9 rounded-xl shrink-0" />
        <div className="flex-1"><Lines first="w-48 h-5" second="w-40" /></div>
      </div>
      <div className={cn(card, "overflow-hidden")}>
        <div className="p-5 sm:p-6 border-b border-border/60"><h2 className="font-bold text-base">Customer Details</h2></div>
        <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-5">
          {["Name", "Phone", "Address"].map(label => (
            <div key={label} className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground">{label}</p>
              <Pulse className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
      <div className={cn(card, "overflow-hidden")}>
        <div className="p-5 sm:p-6 border-b border-border/60"><h2 className="font-bold text-base">Sales History</h2></div>
        <div className="divide-y divide-border/40">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="p-5 flex items-center gap-4">
              <div className="flex-1"><IconAndLines width="w-32" /></div>
              <Pill className="hidden sm:block" />
              <Pulse className="h-4 w-16" />
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
