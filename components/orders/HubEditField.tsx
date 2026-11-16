"use client";

import React, { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { estimateCourierRate } from "@/app/actions";
import { UpayaHubPicker } from "@/components/shared/UpayaHubPicker";
import { BATCH_COURIER_SERVICES, DOOR_TO_DOOR, type CourierArea } from "@/lib/courier";
import { cn, formatNPR } from "@/lib/utils";

type HubSale = { courierAreaId: number | null; courierLocationId: number | null; courierAreaTitle: string | null; courierTrackingCode: string | null; courierServiceId: number | null };

/** The order's saved Upaya service (door to door unless it says branch). */
export const serviceOf = (sale: HubSale) => sale.courierServiceId ?? DOOR_TO_DOOR;

/** The order's saved Upaya hub as the picker's value (null when none). */
export const hubOf = (sale: HubSale): CourierArea | null =>
  sale.courierAreaId && sale.courierLocationId
    ? { areaId: sale.courierAreaId, locationId: sale.courierLocationId, title: sale.courierAreaTitle ?? "", hub: null }
    : null;

/** True when the picked hub differs from the one saved on the order. */
export const hubChanged = (sale: HubSale, picked: CourierArea | null) =>
  (picked?.locationId ?? null) !== (sale.courierLocationId ?? null) || (picked?.areaId ?? null) !== (sale.courierAreaId ?? null);

/**
 * Changes an order's Upaya hub location. Locked once the order is booked with
 * Upaya (the courier keeps the hub it was booked with). Shows Upaya's charge
 * for a newly picked hub; the delivery charge itself is left to the person editing.
 */
export function HubEditField({ sale, value, onChange, service, onServiceChange, address, labelClass }: {
  sale: HubSale;
  value: CourierArea | null;
  onChange: (area: CourierArea | null) => void;
  /** Door to door (3) or door to branch (9). */
  service: number;
  onServiceChange: (service: number) => void;
  address: string;
  labelClass: string;
}) {
  const [rate, setRate] = useState<{ key: string; charge: number | null } | null>(null);
  const changed = hubChanged(sale, value) || service !== serviceOf(sale);
  const key = value ? `${value.locationId}:${service}` : "";

  useEffect(() => {
    if (!value || !changed) return;
    let current = true;
    estimateCourierRate(value.locationId, 1, service)
      .then(r => { if (current) setRate({ key, charge: r.ok && typeof r.data === "number" && r.data > 0 ? r.data : null }); })
      .catch(() => { if (current) setRate({ key, charge: null }); });
    return () => { current = false; };
  }, [value, changed, service, key]);

  if (sale.courierTrackingCode) {
    return (
      <div className="space-y-1.5">
        <span className={labelClass}>Upaya hub location</span>
        <p className="flex items-start gap-1.5 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          <Truck size={13} className="mt-0.5 shrink-0" />
          <span>{sale.courierAreaTitle || "No hub saved"} · {serviceOf(sale) === DOOR_TO_DOOR ? "door to door" : "door to branch"} · booked with Upaya ({sale.courierTrackingCode}), so these can&apos;t change here.</span>
        </p>
      </div>
    );
  }
  const shownRate = value && changed && rate?.key === key ? rate : null;
  const serviceName = service === DOOR_TO_DOOR ? "door-to-door" : "door-to-branch";
  return (
    <div className="space-y-1.5">
      <span className={labelClass}>Upaya delivery</span>
      <div role="radiogroup" aria-label="Upaya delivery service" className="grid grid-cols-2 gap-2">
        {BATCH_COURIER_SERVICES.map(sv => (
          <button
            key={sv.id}
            type="button"
            role="radio"
            aria-checked={service === sv.id}
            onClick={() => onServiceChange(sv.id)}
            className={cn("rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors", service === sv.id ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-muted text-foreground hover:border-primary/30")}
          >
            {sv.label}
          </button>
        ))}
      </div>
      <UpayaHubPicker value={value} onChange={onChange} address={address} />
      {shownRate && (
        <p className="text-[11px] text-muted-foreground">
          {shownRate.charge !== null
            ? <>Upaya&apos;s {serviceName} charge for this hub: <span className="font-semibold text-foreground">{formatNPR(shownRate.charge)}</span>. Change the delivery charge above if it should follow.</>
            : `Upaya has no ${serviceName} price for this hub right now.`}
        </p>
      )}
    </div>
  );
}
