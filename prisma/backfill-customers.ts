// Gives every existing order a customer and a customer ID, oldest customers first.
// Safe to re-run: it only touches orders that don't have a customer yet.
//
//   node prisma/backfill-customers.ts --dry-run   shows what would happen
//   node prisma/backfill-customers.ts             applies it

import pkg from "@prisma/client";
import { customerIdentityKey, findOrCreateCustomerId } from "../lib/customerIdentity.ts";

const { PrismaClient } = pkg;
const db = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function backfillStore(store: { id: string; name: string }) {
  const sales = await db.sale.findMany({
    where: { storeId: store.id, customerId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, customerName: true, customerPhone: true, customerEmail: true },
  });

  const saleIdsByIdentity = new Map<string, string[]>();
  let anonymous = 0;
  for (const sale of sales) {
    const key = customerIdentityKey({ name: sale.customerName, phone: sale.customerPhone, email: sale.customerEmail });
    if (!key) {
      anonymous++;
      continue;
    }
    saleIdsByIdentity.set(key, [...(saleIdsByIdentity.get(key) ?? []), sale.id]);
  }

  if (!dryRun) {
    // One short transaction per customer, so an interrupted run can just be resumed.
    for (const [identityKey, ids] of saleIdsByIdentity) {
      await db.$transaction(async tx => {
        const customerId = await findOrCreateCustomerId(tx, store.id, identityKey);
        await tx.sale.updateMany({ where: { id: { in: ids }, customerId: null }, data: { customerId } });
      });
    }
  }

  console.log(`${store.name}: ${sales.length} order(s) without a customer, ${saleIdsByIdentity.size} customer(s), ${anonymous} anonymous order(s) left as they are.`);
}

async function main() {
  const stores = await db.store.findMany({ select: { id: true, name: true } });
  for (const store of stores) await backfillStore(store);
  console.log(dryRun ? "Dry run: nothing was changed." : "Done.");
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
