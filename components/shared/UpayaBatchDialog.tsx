"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, MapPin, Package, Phone, Truck } from "lucide-react";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { BATCH_COURIER_SERVICES, courierCodAmount, DOOR_TO_BRANCH, DOOR_TO_DOOR } from "@/lib/courier";
import { itemName } from "@/lib/orders";
import { cn, formatNPR } from "@/lib/utils";
import type { Sale } from "@/lib/types";

export interface UpayaBatch {
  ready: Sale[];
  skipped: { sale: Sale; reason: string }[];
}

/** Service id per sale id; anything not listed goes door to door. */
export type UpayaServices = Record<string, number>;

/**
 * Bulk "Send to Upaya", in two steps. First the list of ticked orders, where
 * each can be switched from door to door (the default) to door to branch.
 * Then a review of exactly what will be booked (counts, COD to collect and
 * each order grouped by service) before anything is sent.
 */
export function UpayaBatchDialog({
  batch,
  onClose,
  onSend,
}: {
  batch: UpayaBatch | null;
  onClose: () => void;
  onSend: (services: UpayaServices) => void;
}) {
  // Keyed by the batch so a new selection starts fresh (door to door, step 1).
  return (
    <Modal
      open={batch !== null}
      onClose={onClose}
      size="lg"
      icon={Truck}
      title={batch && batch.ready.length > 0 ? "Send to Upaya" : "Nothing to send to Upaya"}
    >
      {batch && <BatchBody key={batch.ready.map(s => s.id).join()} batch={batch} onClose={onClose} onSend={onSend} />}
    </Modal>
  );
}

function BatchBody({ batch, onClose, onSend }: { batch: UpayaBatch; onClose: () => void; onSend: (services: UpayaServices) => void }) {
  const [services, setServices] = useState<UpayaServices>({});
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [showSkipped, setShowSkipped] = useState(batch.ready.length === 0);

  // Each order starts on the service chosen when it was made.
  const savedService = (id: string) => batch.ready.find(s => s.id === id)?.courierServiceId ?? DOOR_TO_DOOR;
  const serviceOf = (id: string) => services[id] ?? savedService(id);
  const setAll = (id: number) => setServices(Object.fromEntries(batch.ready.map(s => [s.id, id])));

  const totals = useMemo(() => {
    let cod = 0;
    let codOrders = 0;
    let branch = 0;
    for (const sale of batch.ready) {
      const amount = courierCodAmount(sale);
      cod += amount;
      if (amount > 0) codOrders += 1;
      if ((services[sale.id] ?? sale.courierServiceId ?? DOOR_TO_DOOR) === DOOR_TO_BRANCH) branch += 1;
    }
    return { cod, codOrders, branch, door: batch.ready.length - branch };
  }, [batch.ready, services]);

  const count = batch.ready.length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  if (count === 0) {
    return (
      <div className="p-5 sm:p-6 space-y-4 text-sm">
        <p className="text-muted-foreground">None of the ticked orders can go to Upaya yet:</p>
        <SkippedList skipped={batch.skipped} />
        <Button variant="secondary" onClick={onClose} className="w-full">Close</Button>
      </div>
    );
  }

  /* ── Step 2: review everything before it's booked ── */
  if (step === "review") {
    const groups = BATCH_COURIER_SERVICES
      .map(service => ({ service, sales: batch.ready.filter(s => serviceOf(s.id) === service.id) }))
      .filter(group => group.sales.length > 0);

    return (
      <div className="flex flex-col">
        <div className="p-5 sm:p-6 space-y-5 text-sm">
          <div>
            <p className="font-semibold text-foreground">Review before sending</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Each order is booked with Upaya separately, and Upaya will come to pick them up. Check the list once more.
            </p>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Orders" value={String(count)} />
            <Stat label="Door to door" value={String(totals.door)} />
            <Stat label="Door to branch" value={String(totals.branch)} highlight={totals.branch > 0} />
            <Stat label="COD to collect" value={formatNPR(totals.cod)} sub={`from ${plural(totals.codOrders, "order")}`} />
          </dl>

          {groups.map(({ service, sales }) => (
            <section key={service.id}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {service.label} · {sales.length}
              </h3>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {sales.map(sale => {
                  const cod = courierCodAmount(sale);
                  return (
                    <li key={sale.id} className="flex items-start gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-mono text-xs text-muted-foreground">{sale.invoiceNumber}</span>
                          <span className="font-medium text-foreground">{sale.customerName ?? "Walk-in"}</span>
                          <span className="text-xs text-muted-foreground">{sale.customerPhone}</span>
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {sale.courierAreaTitle ?? `Hub #${sale.courierAreaId}`} · {sale.items.reduce((n, i) => n + i.quantity, 0)} item(s)
                        </p>
                      </div>
                      <span className={cn("shrink-0 text-xs font-semibold", cod > 0 ? "text-foreground" : "text-emerald-600 dark:text-emerald-400")}>
                        {cod > 0 ? `COD ${formatNPR(cod)}` : "Paid"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {batch.skipped.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {plural(batch.skipped.length, "ticked order")} won&apos;t be sent (see the previous step for why).
            </p>
          )}
        </div>

        <div className="flex gap-3 border-t border-border px-5 sm:px-6 pt-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <Button variant="secondary" onClick={() => setStep("edit")} className="flex-1">
            <ArrowLeft size={14} /> Back
          </Button>
          <Button onClick={() => onSend(services)} className="flex-1">
            <Truck size={14} /> Send {plural(count, "order")}
          </Button>
        </div>
      </div>
    );
  }

  /* ── Step 1: the list, with door to door / door to branch per order ── */
  return (
    <div className="flex flex-col">
      <div className="p-5 sm:p-6 space-y-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground">
            {plural(count, "order")} ready · {totals.door} door to door · {totals.branch} door to branch
          </p>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">All:</span>
            {BATCH_COURIER_SERVICES.map(service => (
              <button
                key={service.id}
                type="button"
                onClick={() => setAll(service.id)}
                className="rounded-md border border-border px-2 py-1 font-medium text-foreground hover:bg-muted"
              >
                {service.label}
              </button>
            ))}
          </div>
        </div>

        <ul className="space-y-2.5">
          {batch.ready.map(sale => {
            const cod = courierCodAmount(sale);
            const current = serviceOf(sale.id);
            return (
              <li
                key={sale.id}
                className={cn(
                  "rounded-xl border p-3 sm:p-3.5 transition-colors",
                  current === DOOR_TO_BRANCH ? "border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/20" : "border-border"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-xs text-muted-foreground">{sale.invoiceNumber}</span>
                      <span className="font-semibold text-foreground">{sale.customerName ?? "Walk-in"}</span>
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Phone size={12} className="shrink-0" /> {sale.customerPhone}
                    </p>
                    <p className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <MapPin size={12} className="mt-0.5 shrink-0" />
                      <span className="min-w-0">
                        <span className="font-medium text-foreground">{sale.courierAreaTitle ?? `Hub #${sale.courierAreaId}`}</span>
                        {sale.customerAddress ? ` · ${sale.customerAddress}` : ""}
                      </span>
                    </p>
                    <p className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Package size={12} className="mt-0.5 shrink-0" />
                      <span className="min-w-0">{sale.items.map(item => `${item.quantity} × ${itemName(item)}`).join(", ")}</span>
                    </p>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span className={cn("text-xs font-semibold", cod > 0 ? "text-foreground" : "text-emerald-600 dark:text-emerald-400")}>
                      {cod > 0 ? `COD ${formatNPR(cod)}` : "Paid · no COD"}
                    </span>
                    <div role="radiogroup" aria-label={`Service for ${sale.invoiceNumber}`} className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
                      {BATCH_COURIER_SERVICES.map(service => (
                        <button
                          key={service.id}
                          type="button"
                          role="radio"
                          aria-checked={current === service.id}
                          onClick={() => setServices(prev => ({ ...prev, [sale.id]: service.id }))}
                          className={cn(
                            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                            current === service.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {service.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {batch.skipped.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowSkipped(v => !v)}
              aria-expanded={showSkipped}
              className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <ChevronDown size={14} className={cn("transition-transform", showSkipped && "rotate-180")} />
              Not sent ({batch.skipped.length})
            </button>
            {showSkipped && <SkippedList skipped={batch.skipped} />}
          </div>
        )}
      </div>

      <div className="flex gap-3 border-t border-border px-5 sm:px-6 pt-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button onClick={() => setStep("review")} className="flex-1">Review {plural(count, "order")}</Button>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={cn("rounded-xl border px-3 py-2.5", highlight ? "border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/20" : "border-border bg-muted/30")}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-base font-bold text-foreground">{value}</dd>
      {sub && <dd className="text-[11px] text-muted-foreground">{sub}</dd>}
    </div>
  );
}

function SkippedList({ skipped }: { skipped: UpayaBatch["skipped"] }) {
  return (
    <ul className="mt-1.5 max-h-48 overflow-y-auto space-y-1 text-xs">
      {skipped.map(({ sale, reason }) => (
        <li key={sale.id} className="flex gap-2">
          <span className="font-mono shrink-0">{sale.invoiceNumber}</span>
          <span className="text-muted-foreground min-w-0">{sale.customerName ?? "Walk-in"}: {reason}</span>
        </li>
      ))}
    </ul>
  );
}
