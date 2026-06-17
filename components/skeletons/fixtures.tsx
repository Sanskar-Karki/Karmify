// components/skeletons/fixtures.tsx
// Static fixture JSX used by boneyard-js during `npx boneyard-js build`
// to measure exact element positions and generate bone layout data.

export function DashboardFixture() {
  return (
    <div className="space-y-8">
      {/* Top banner */}
      <div className="h-24 rounded-2xl bg-muted w-full" />
      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-6">
        {[1,2,3,4].map(i => <div key={i} className="h-28 rounded-2xl bg-card border border-border" />)}
      </div>
      {/* Charts row */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 h-72 rounded-2xl bg-card border border-border" />
        <div className="h-72 rounded-2xl bg-card border border-border" />
      </div>
      {/* Bottom row */}
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 h-56 rounded-2xl bg-card border border-border" />
        <div className="h-56 rounded-2xl bg-card border border-border" />
      </div>
    </div>
  );
}

export function ProductsFixture() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <div className="h-10 w-48 rounded-xl bg-muted" />
        <div className="h-10 w-36 rounded-xl bg-primary/20" />
      </div>
      <div className="flex gap-3">
        <div className="h-10 flex-1 rounded-xl bg-muted" />
        <div className="h-10 w-64 rounded-xl bg-muted" />
      </div>
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {/* Table header */}
        <div className="h-12 bg-muted/30 border-b border-border" />
        {/* Table rows */}
        {[1,2,3,4,5,6].map(i => (
          <div key={i} className="h-16 border-b border-border/40 flex items-center gap-4 px-5">
            <div className="w-9 h-9 rounded-xl bg-muted" />
            <div className="space-y-1.5 flex-1">
              <div className="h-3 w-40 rounded bg-muted" />
              <div className="h-2.5 w-24 rounded bg-muted/60" />
            </div>
            <div className="h-6 w-20 rounded-lg bg-muted hidden md:block" />
            <div className="h-8 w-24 rounded-lg bg-muted" />
            <div className="h-6 w-16 rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function InventoryFixture() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <div className="h-10 w-56 rounded-xl bg-muted" />
        <div className="h-10 w-40 rounded-xl bg-primary/20" />
      </div>
      {/* Warehouse table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="h-14 border-b border-border bg-muted/20 px-5 flex items-center justify-between">
          <div className="h-4 w-40 rounded bg-muted" />
          <div className="flex gap-2">
            <div className="h-6 w-20 rounded-lg bg-muted" />
            <div className="h-6 w-24 rounded-lg bg-muted" />
          </div>
        </div>
        <div className="h-10 bg-muted/10 border-b border-border/40" />
        {[1,2,3].map(i => (
          <div key={i} className="h-16 border-b border-border/30 flex items-center gap-4 px-5">
            <div className="w-8 h-8 rounded-lg bg-muted" />
            <div className="space-y-1.5 flex-1">
              <div className="h-3 w-36 rounded bg-muted" />
              <div className="h-2.5 w-20 rounded bg-muted/60" />
            </div>
            <div className="h-5 w-12 rounded bg-muted" />
            <div className="h-5 w-12 rounded bg-muted" />
            <div className="h-5 w-14 rounded bg-muted" />
            <div className="h-6 w-12 rounded-full bg-muted" />
          </div>
        ))}
      </div>
      {/* Movement log */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="h-14 border-b border-border" />
        {[1,2,3,4,5].map(i => (
          <div key={i} className="h-14 border-b border-border/30 flex items-center gap-4 px-5">
            <div className="h-6 w-24 rounded-lg bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-32 rounded bg-muted" />
              <div className="h-2.5 w-20 rounded bg-muted/60" />
            </div>
            <div className="h-5 w-8 rounded bg-muted" />
            <div className="h-4 w-24 rounded bg-muted hidden md:block" />
            <div className="h-4 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SalesFixture() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <div className="h-10 w-48 rounded-xl bg-muted" />
        <div className="h-10 w-36 rounded-xl bg-muted" />
      </div>
      <div className="grid grid-cols-12 gap-6">
        {/* Left product grid */}
        <div className="col-span-7 space-y-4">
          <div className="flex gap-2">
            <div className="h-10 flex-1 rounded-xl bg-muted" />
            <div className="h-10 w-28 rounded-xl bg-muted" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[1,2,3,4,5,6].map(i => <div key={i} className="h-36 rounded-2xl bg-card border border-border" />)}
          </div>
        </div>
        {/* Right cart */}
        <div className="col-span-5 space-y-4">
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="h-12 border-b border-border bg-muted/20" />
            {[1,2,3].map(i => (
              <div key={i} className="h-14 border-b border-border/30 flex items-center gap-3 px-4">
                <div className="flex-1 space-y-1">
                  <div className="h-3 w-28 rounded bg-muted" />
                  <div className="h-2.5 w-16 rounded bg-muted/60" />
                </div>
                <div className="flex gap-1">
                  <div className="w-6 h-6 rounded-lg bg-muted" />
                  <div className="w-6 h-6 rounded-lg bg-muted" />
                  <div className="w-6 h-6 rounded-lg bg-muted" />
                </div>
                <div className="h-4 w-14 rounded bg-muted" />
              </div>
            ))}
            <div className="p-4 space-y-3">
              <div className="h-9 rounded-xl bg-muted" />
              <div className="h-9 rounded-xl bg-muted" />
              <div className="h-9 rounded-xl bg-muted" />
              <div className="h-24 rounded-xl bg-muted/40 border border-border" />
              <div className="h-11 rounded-xl bg-primary/30" />
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl h-48" />
        </div>
      </div>
    </div>
  );
}

export function PurchasesFixture() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <div className="h-10 w-48 rounded-xl bg-muted" />
        <div className="h-10 w-44 rounded-xl bg-primary/20" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[1,2,3].map(i => <div key={i} className="h-24 rounded-2xl bg-card border border-border" />)}
      </div>
      <div className="space-y-3">
        {[1,2,3].map(i => (
          <div key={i} className="h-20 rounded-2xl bg-card border border-border flex items-center gap-4 px-5">
            <div className="w-10 h-10 rounded-xl bg-muted shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-36 rounded bg-muted" />
              <div className="h-3 w-52 rounded bg-muted/60" />
            </div>
            <div className="h-7 w-20 rounded-xl bg-muted" />
            <div className="flex gap-2">
              <div className="h-7 w-28 rounded-xl bg-emerald-200/40" />
              <div className="h-7 w-20 rounded-xl bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CustomersFixture() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between">
        <div className="h-10 w-48 rounded-xl bg-muted" />
        <div className="h-10 w-64 rounded-xl bg-muted" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[1,2,3].map(i => <div key={i} className="h-24 rounded-2xl bg-card border border-border" />)}
      </div>
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="h-12 bg-muted/30 border-b border-border" />
        {[1,2,3,4,5].map(i => (
          <div key={i} className="h-16 border-b border-border/40 flex items-center gap-4 px-5">
            <div className="w-9 h-9 rounded-full bg-muted" />
            <div className="space-y-1.5 flex-1">
              <div className="h-3 w-40 rounded bg-muted" />
              <div className="h-2.5 w-28 rounded bg-muted/60" />
            </div>
            <div className="h-5 w-16 rounded bg-muted hidden md:block" />
            <div className="h-5 w-20 rounded bg-muted" />
            <div className="h-6 w-16 rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsFixture() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="h-10 w-40 rounded-xl bg-muted" />
      <div className="h-12 w-80 rounded-2xl bg-muted/40 border border-border" />
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="h-16 border-b border-border bg-muted/10" />
        <div className="p-6 grid grid-cols-2 gap-5">
          {[1,2,3,4,5,6,7,8].map(i => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="h-10 rounded-xl bg-muted/40 border border-border" />
            </div>
          ))}
        </div>
        <div className="px-6 pb-6">
          <div className="h-10 w-32 rounded-xl bg-primary/30" />
        </div>
      </div>
    </div>
  );
}
