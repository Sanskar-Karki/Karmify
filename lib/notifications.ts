import { WEBSITE_ORDER_NOTIFICATION } from "@/lib/orders";

// What each notification is about and where it leads, worked out from its
// title and message (the table stores only title, message and type).

export type NotificationCategory = "orders" | "stock" | "products" | "purchases" | "other";

export const NOTIFICATION_CATEGORIES: { id: NotificationCategory; label: string }[] = [
  { id: "orders", label: "Orders" },
  { id: "stock", label: "Stock" },
  { id: "products", label: "Products" },
  { id: "purchases", label: "Purchases" },
];

interface NotificationLike {
  title: string;
  message: string;
}

export function notificationCategory(n: NotificationLike): NotificationCategory {
  const title = n.title.toLowerCase();
  // "Website size/item not in inventory" come from an order too, but they're fixed in Products.
  if (n.title === WEBSITE_ORDER_NOTIFICATION || title.includes("order")) return "orders";
  if (title.includes("low stock")) return "stock";
  if (title.includes("size") || title.includes("product") || title.includes("not in inventory")) return "products";
  if (title.includes("stock received") || /\bPO-\d/.test(n.message)) return "purchases";
  return "other";
}

const INVOICE = /\bINV-\d{8}-\d+\b/;
const PURCHASE_ORDER = /\bPO-\d{8}-\d+\b/;
const QUOTED = /"([^"]+)"/;

/** The page that deals with this notification, narrowed to the order/product it names when possible. */
export function notificationLink(n: NotificationLike): { href: string; label: string } | null {
  const title = n.title.toLowerCase();
  const quoted = n.message.match(QUOTED)?.[1];
  const q = (value: string) => `?q=${encodeURIComponent(value)}`;

  if (title.includes("not in inventory") || title.includes("set sizes") || title.includes("split received stock")) {
    return { href: `/products${quoted ? q(quoted) : ""}`, label: "Fix in Products" };
  }
  if (title.includes("low stock")) {
    return { href: `/inventory${quoted ? q(quoted) : ""}`, label: "View stock" };
  }
  if (title.includes("stock received") || PURCHASE_ORDER.test(n.message)) {
    const po = n.message.match(PURCHASE_ORDER)?.[0];
    return { href: `/purchases${po ? q(po) : ""}`, label: "View purchase" };
  }
  if (n.title === WEBSITE_ORDER_NOTIFICATION || title.includes("order")) {
    const invoice = n.message.match(INVOICE)?.[0];
    return { href: `/customers${invoice ? q(invoice) : ""}`, label: invoice ? "Open order" : "View orders" };
  }
  return null;
}

export function timeAgo(value: Date | string) {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "Today", "Yesterday", or the date, for grouping the list. */
export function dayLabel(value: Date | string) {
  const date = new Date(value);
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(date)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}
