import type { Sale } from "@/lib/types";

// Display metadata and grouping shared by the order and customer pages.

/** Title of the notification a new website order raises. */
export const WEBSITE_ORDER_NOTIFICATION = "New website order";

// Letter sizes (XS…5XL), numbers (32, 32W, 10.5) and "free/one size": how a lone
// "L" or "Navy" on a sale line is told apart.
const SIZE_LIKE = /^(x{0,3}s|m|x{0,4}l|\d\s*x{1,2}l|\d+(\.\d+)?\s*[a-z]{0,3}|free\s*size|one\s*size)$/i;

/**
 * A sale line's size and colour, read from its stored text: "L · Navy" (size
 * first, as both POS sales and website orders write it), or just "L" / "Navy".
 */
export function itemOptions(item: { variant?: string | null }): { size: string; color: string } {
  const parts = (item.variant ?? "").split("·").map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) return { size: "", color: "" };
  if (parts.length === 1) return SIZE_LIKE.test(parts[0]) ? { size: parts[0], color: "" } : { size: "", color: parts[0] };
  return { size: parts[0], color: parts.slice(1).join(" · ") };
}

/** "Colour: Navy · Size: L": only what's set; "" when neither. */
export function optionsText(size?: string | null, color?: string | null, separator = " · ") {
  return [color?.trim() && `Colour: ${color.trim()}`, size?.trim() && `Size: ${size.trim()}`].filter(Boolean).join(separator);
}

/** A sale line's colour and size spelled out, e.g. "Colour: Navy · Size: L". */
export function itemOptionsText(item: { variant?: string | null }, separator = " · ") {
  const { size, color } = itemOptions(item);
  return optionsText(size, color, separator);
}

/** "Dual Tone Hoodie (Colour: Navy, Size: L)": the product plus the colour and size chosen, on one line. */
export function itemName(item: { variant?: string | null; product: { name: string } }) {
  const options = itemOptionsText(item, ", ");
  return options ? `${item.product.name} (${options})` : item.product.name;
}

export const DELIVERY_STATUSES = [
  { value: "IN_PROCESS", label: "In Process" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "RETURN_PROCESS", label: "Return Process" },
  { value: "RETURNED", label: "Returned" },
  { value: "CANCELLED", label: "Cancelled" },
];

/** Cancelled orders never happened, so they stay out of revenue totals. */
export const countsAsSale = (sale: { deliveryStatus?: string | null }) => sale.deliveryStatus !== "CANCELLED";

export const DELIVERY_STYLES: Record<string, string> = {
  IN_PROCESS: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
  DELIVERED: "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400",
  RETURN_PROCESS: "bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400",
  RETURNED: "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400",
  CANCELLED: "bg-zinc-200 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-300",
};

export const PAYMENT_STYLES: Record<string, string> = {
  UNPAID: "bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400",
  PARTIAL: "bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400",
  PAID: "bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400",
};

/** Website imports prefix the address with a "[Brand]" tag that isn't part of it. */
export const deliveryAddress = (address?: string | null) => (address ?? "").replace(/^\[[^\]]*\]\s*/, "");

type CustomerFields = {
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerName?: string | null;
  customer?: { code: string } | null;
};

/** The key customer pages used before customer IDs, so saved links keep working. */
export function contactKey(sale: CustomerFields) {
  return (sale.customerEmail || sale.customerPhone || sale.customerName || "unknown").toLowerCase();
}

/** What orders are grouped under, and the customer page's URL key. */
export function customerKey(sale: CustomerFields) {
  return sale.customer?.code ?? contactKey(sale);
}

export type Customer = {
  key: string;
  code: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  orderCount: number;
  totalSpent: number;
  sales: Sale[];
};

/** Rolls orders (newest first) up into customers, most recent customer first. */
export function groupSalesByCustomer(sales: Sale[]): Customer[] {
  const customers = new Map<string, Customer>();

  for (const sale of sales) {
    if (!sale.customerEmail && !sale.customerPhone && !sale.customerName) continue;

    const key = customerKey(sale);
    const existing = customers.get(key);
    if (existing) {
      existing.orderCount += 1;
      existing.totalSpent += sale.totalAmount;
      existing.sales.push(sale);
      existing.email ??= sale.customerEmail;
      existing.phone ??= sale.customerPhone;
      existing.address ??= sale.customerAddress;
      if (existing.name === "Walk-in Customer" && sale.customerName) existing.name = sale.customerName;
    } else {
      customers.set(key, {
        key,
        code: sale.customer?.code ?? null,
        name: sale.customerName || "Walk-in Customer",
        email: sale.customerEmail || null,
        phone: sale.customerPhone || null,
        address: sale.customerAddress || null,
        orderCount: 1,
        totalSpent: sale.totalAmount,
        sales: [sale],
      });
    }
  }

  return Array.from(customers.values());
}
