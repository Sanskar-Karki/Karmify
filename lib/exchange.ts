// Exchange orders: a customer swaps items from an order they already have (a
// different size, say). The swap is a new order linked to the old one. It sends
// the replacement, and Upaya's rider collects the old items in the same visit
// (an Upaya "exchange_order"). The old items are credited against the new order
// (recorded as discount), the customer pays the delivery, and the old items go
// back into stock only when staff tick them received.
//
// Shared by the server (createSale, markExchangeReceived, Upaya booking) and the
// pages (POS exchange mode, order cards), so it has no server-only imports.

export type ExchangeLine = {
  /** The line on the original order the items come from. */
  itemId: string;
  productId: string;
  variantId: string | null;
  name: string;
  /** Size/colour as on the original line ("L · Navy"). */
  variant: string | null;
  quantity: number;
  /** What the customer paid for one: its price, less its share of that order's discount. */
  unitCredit: number;
};

/** What an exchange order keeps in its `exchange` column. */
export type SaleExchange = {
  /** The order the items come back from. */
  ofSaleId: string;
  ofInvoice: string;
  items: ExchangeLine[];
  /** What the items coming back are worth, taken off this order as discount. */
  credit: number;
  /** When staff ticked the old items received and they went back into stock (ISO), or null. */
  receivedAt: string | null;
};

const isLine = (value: unknown): value is ExchangeLine => {
  const l = value as ExchangeLine;
  return typeof l === "object" && l !== null && typeof l.itemId === "string" && typeof l.productId === "string"
    && typeof l.name === "string" && Number.isInteger(l.quantity) && l.quantity > 0 && Number.isFinite(l.unitCredit);
};

/** The exchange saved on an order, or null for an ordinary order. */
export function exchangeOf(sale: { exchange?: unknown }): SaleExchange | null {
  const e = sale.exchange as SaleExchange | null | undefined;
  if (!e || typeof e !== "object" || typeof e.ofSaleId !== "string" || !Array.isArray(e.items) || !e.items.every(isLine)) return null;
  return {
    ofSaleId: e.ofSaleId,
    ofInvoice: typeof e.ofInvoice === "string" ? e.ofInvoice : "",
    items: e.items.map(l => ({ ...l, variantId: l.variantId ?? null, variant: l.variant ?? null })),
    credit: Number.isFinite(e.credit) ? e.credit : 0,
    receivedAt: typeof e.receivedAt === "string" ? e.receivedAt : null,
  };
}

/** "Dual Tone Hoodie (M · Navy)". */
export const exchangeLineName = (line: Pick<ExchangeLine, "name" | "variant">) => (line.variant ? `${line.name} (${line.variant})` : line.name);

/**
 * What one unit of each line cost the customer: its price less its share of the
 * order's discount (shared by value). Keyed by line id, in whole paisa.
 */
export function unitCredits(order: { discount?: number | null; items: { id: string; quantity: number; unitPrice: number }[] }) {
  const goods = order.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const share = goods > 0 ? Math.min(1, Math.max(0, order.discount ?? 0) / goods) : 0;
  return new Map(order.items.map(i => [i.id, Math.round(i.unitPrice * (1 - share) * 100) / 100]));
}

/** The credit for the chosen lines: what the customer paid for those units. */
export const creditFor = (lines: Pick<ExchangeLine, "quantity" | "unitCredit">[]) =>
  Math.round(lines.reduce((sum, l) => sum + l.quantity * l.unitCredit, 0) * 100) / 100;

/** An exchange still waiting for its old items: not received, and the exchange order not cancelled. */
export const awaitingReturn = (sale: { exchange?: unknown; deliveryStatus?: string | null }) => {
  const e = exchangeOf(sale);
  return Boolean(e && !e.receivedAt && sale.deliveryStatus !== "CANCELLED");
};

/**
 * Units of each line of `originalId` already on their way back in another
 * exchange (keyed by line id), so the same units can't be swapped twice.
 */
export function unitsInOpenExchanges(orders: { id: string; exchange?: unknown; deliveryStatus?: string | null }[], originalId: string) {
  const out = new Map<string, number>();
  for (const order of orders) {
    const e = exchangeOf(order);
    if (!e || e.ofSaleId !== originalId || !awaitingReturn(order)) continue;
    for (const line of e.items) out.set(line.itemId, (out.get(line.itemId) ?? 0) + line.quantity);
  }
  return out;
}

/** Units of a line that can still be exchanged: not returned, and not already in an open exchange. */
export const exchangeableUnits = (item: { id: string; quantity: number; returnedQty?: number | null }, open: Map<string, number>) =>
  Math.max(0, item.quantity - (item.returnedQty ?? 0) - (open.get(item.id) ?? 0));
