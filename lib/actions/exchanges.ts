"use server";

import { DeliveryStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";
import { logActivity } from "@/lib/actions/helpers";
import { guarded, UserError } from "@/lib/actions/result";
import { exchangeOf } from "@/lib/exchange";
import { openExchangeUnits, returnOrderLines } from "@/lib/stockOut";

// Exchange orders are created by the POS (createSale with `exchangeOf`); see
// lib/exchange.ts. This is the other half: the old items arriving back.

/**
 * Staff have the old items of an exchange in hand: they go back in stock, to
 * their exact size/colour, and count as returned on the original order. The
 * original order keeps its status and payment (it was a sale; only the items
 * were swapped). Once only.
 */
export async function markExchangeReceived(saleId: string) {
  return guarded("Could not mark the old items received.", async () => {
    const tenant = await requireTenant();
    const storeId = tenant.storeId;

    const result = await db.$transaction(async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: saleId, storeId },
        select: { id: true, invoiceNumber: true, deliveryStatus: true, exchange: true, updatedAt: true },
      });
      if (!sale) throw new UserError("That order no longer exists. Refresh the page and try again.");
      const exchange = exchangeOf(sale);
      if (!exchange) throw new UserError(`${sale.invoiceNumber} isn't an exchange order.`);
      if (exchange.receivedAt) throw new UserError("The old items were already marked received.");
      if (sale.deliveryStatus === DeliveryStatus.CANCELLED) throw new UserError("This exchange was cancelled, so nothing is coming back.");

      // Claimed first (only if nobody changed the order since it was read), so two clicks can't both put stock back.
      const claimed = await tx.sale.updateMany({
        where: { id: sale.id, storeId, updatedAt: sale.updatedAt },
        data: { exchange: { ...exchange, receivedAt: new Date().toISOString() } as unknown as object },
      });
      if (claimed.count === 0) throw new UserError("This order was just changed by someone else. Refresh and try again.");

      const original = await tx.sale.findFirst({
        where: { id: exchange.ofSaleId, storeId },
        select: {
          id: true, invoiceNumber: true, warehouseId: true,
          items: { select: { id: true, productId: true, variantId: true, quantity: true, returnedQty: true, variant: true, product: { select: { name: true } } } },
        },
      });
      if (!original) {
        throw new UserError(`The original order ${exchange.ofInvoice} no longer exists, so its items can't be put back from here. Add them back to stock on the product's page instead.`);
      }
      const back = await returnOrderLines(tx, {
        storeId,
        userId: tenant.userId,
        sale: original,
        lines: exchange.items.map(l => ({ itemId: l.itemId, quantity: l.quantity })),
        notes: `Back from exchange ${sale.invoiceNumber} (order ${original.invoiceNumber})`,
        // Other exchanges still waiting on the same order keep their units (this one's are no longer counted: it's received).
        held: await openExchangeUnits(tx, storeId, original.id),
      });
      return { invoiceNumber: sale.invoiceNumber, ofInvoice: original.invoiceNumber, ...back };
    }, { timeout: 20_000, maxWait: 10_000 });

    await logActivity(
      tenant,
      "Exchange Items Received",
      `Old items back from exchange ${result.invoiceNumber} (order ${result.ofInvoice}): ${result.parts.join(", ")}.`.slice(0, 1000),
    );
    revalidatePath("/customers");
    revalidatePath("/inventory");
    revalidatePath("/products");
    return { invoiceNumber: result.invoiceNumber, units: result.units, restocked: result.restocked };
  });
}
