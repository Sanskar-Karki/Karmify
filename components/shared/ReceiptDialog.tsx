"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Printer, Receipt } from "lucide-react";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { Dropdown } from "@/components/shared/Dropdown";
import { formatNPR } from "@/lib/utils";
import { itemOptionsText } from "@/lib/orders";
import type { StoreProfile } from "@/lib/storeProfile";

/** What a receipt needs from a sale (any saved sale, today's or old). */
export interface ReceiptSale {
  invoiceNumber: string;
  createdAt: Date | string;
  customerName: string | null;
  customerAddress?: string | null;
  customer?: { code: string } | null;
  paymentMethod: "COD" | "QR";
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID";
  discount: number;
  deliveryAmount: number;
  codAmount: number;
  totalAmount: number;
  items: { id: string; quantity: number; unitPrice: number; variant?: string | null; product: { name: string } }[];
}

type Paper = "thermal" | "a4";
const PAPER_OPTIONS = [
  { value: "thermal", label: "Receipt printer (80 mm)" },
  { value: "a4", label: "A4 paper" },
];
// Zero page margin: browsers print their own header/footer (page title, address,
// date) only inside the margins, so with none they can't appear on the receipt.
const PAGE_RULES: Record<Paper, string> = {
  thermal: "@media print { @page { size: 80mm auto; margin: 0; } }",
  a4: "@media print { @page { size: A4; margin: 0; } }",
};
const PAPER_STORAGE_KEY = "karmify_receipt_paper";

function readSavedPaper(): Paper {
  try {
    return localStorage.getItem(PAPER_STORAGE_KEY) === "a4" ? "a4" : "thermal";
  } catch {
    return "thermal";
  }
}

/** How it was paid, worked out from what the sale stores. */
function paymentLabel(sale: ReceiptSale) {
  const grand = sale.totalAmount + sale.deliveryAmount;
  if (sale.paymentStatus === "PARTIAL") return "Partially paid";
  if (sale.paymentStatus === "PAID" && sale.paymentMethod === "QR") return sale.customerAddress ? "Fully paid" : "QR (paid)";
  if (sale.paymentStatus === "PAID") return sale.customerAddress && sale.codAmount > 0 ? "Cash on Delivery (collected)" : "Cash (paid)";
  return grand > 0 ? "Cash on Delivery" : "—";
}

/** A receipt in plain black on white, at the printed width. */
export function SaleReceipt({ sale, store }: { sale: ReceiptSale; store: StoreProfile }) {
  const grand = sale.totalAmount + sale.deliveryAmount;
  const advance = sale.paymentStatus === "PARTIAL" ? Math.max(0, grand - sale.codAmount) : 0;
  const collect = sale.paymentStatus === "PAID" ? 0 : sale.paymentMethod === "COD" ? sale.codAmount || grand : 0;
  const row = "flex justify-between gap-3";

  return (
    <div className="w-[72mm] bg-white text-black px-[4mm] py-[5mm] text-[9.5pt] leading-snug font-sans">
      <div className="text-center">
        <p className="text-[13pt] font-bold">{store.name}</p>
        {(store.address || store.phone) && <p className="text-[8pt]">{[store.address, store.phone].filter(Boolean).join(" · ")}</p>}
        <p className="mt-1 font-mono text-[9pt]">{sale.invoiceNumber}</p>
      </div>

      <div className="mt-3 border-t border-dashed border-black pt-2 space-y-0.5">
        <div className={row}><span>Customer</span><span className="text-right font-semibold">{sale.customerName ?? "Walk-in Customer"}</span></div>
        {sale.customer && <div className={row}><span>Customer ID</span><span className="font-mono">{sale.customer.code}</span></div>}
        <div className={row}><span>Date</span><span className="text-right">{new Date(sale.createdAt).toLocaleString()}</span></div>
        <div className={row}><span>Payment</span><span className="text-right font-semibold">{paymentLabel(sale)}</span></div>
      </div>

      <div className="mt-2 border-t border-dashed border-black pt-2 space-y-1.5">
        {/* Full product name, then its colour and size, then quantity × price. */}
        {sale.items.map(item => {
          const options = itemOptionsText(item);
          return (
            <div key={item.id}>
              <div className={row}>
                <span className="min-w-0 break-words font-semibold">{item.product.name}</span>
                <span className="shrink-0">{formatNPR(item.unitPrice * item.quantity)}</span>
              </div>
              {options && <p className="text-[8.5pt]">{options}</p>}
              <p className="text-[8.5pt]">{item.quantity} × {formatNPR(item.unitPrice)}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-2 border-t border-dashed border-black pt-2 space-y-0.5">
        {sale.discount > 0 && <div className={row}><span>Discount</span><span>−{formatNPR(sale.discount)}</span></div>}
        {sale.deliveryAmount > 0 && <div className={row}><span>Delivery</span><span>{formatNPR(sale.deliveryAmount)}</span></div>}
        <div className={`${row} border-t border-black pt-1 text-[11pt] font-bold`}><span>TOTAL</span><span>{formatNPR(grand)}</span></div>
        {advance > 0 && <div className={row}><span>Advance paid</span><span>−{formatNPR(advance)}</span></div>}
        {collect > 0 && <div className={`${row} font-bold`}><span>COD to collect</span><span>{formatNPR(collect)}</span></div>}
      </div>

      <p className="mt-3 text-center text-[8pt]">Thank you for shopping at {store.name}!</p>
    </div>
  );
}

/** Preview and print one or many receipts, one per page. */
export function ReceiptDialog({
  open,
  onClose,
  sales,
  store,
}: {
  open: boolean;
  onClose: () => void;
  sales: ReceiptSale[];
  store: StoreProfile;
}) {
  const [paper, setPaper] = useState<Paper>(readSavedPaper);
  const first = sales[0];
  if (!first) return null;
  const many = sales.length > 1;

  function changePaper(value: string) {
    const next = value as Paper;
    setPaper(next);
    try {
      localStorage.setItem(PAPER_STORAGE_KEY, next);
    } catch {
      // Private browsing: the choice still applies now.
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={many ? `${sales.length} receipts` : "Receipt"}
        description={many ? "One receipt per page. The first is shown below." : `Receipt for ${first.invoiceNumber}`}
        icon={Receipt}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} className="flex-1">
              <ArrowLeft size={14} /> Back
            </Button>
            <Button onClick={() => window.print()} className="flex-1" data-autofocus>
              <Printer size={14} /> {many ? `Print ${sales.length} Receipts` : "Print Receipt"}
            </Button>
          </>
        }
      >
        <div className="p-4 sm:p-5 space-y-3">
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Paper</span>
            <Dropdown aria-label="Paper" value={paper} onChange={changePaper} options={PAPER_OPTIONS} />
          </div>
          <div className="flex justify-center rounded-xl bg-muted p-3 max-h-[55vh] overflow-auto">
            <div className="shadow-lg">
              <SaleReceipt sale={first} store={store} />
            </div>
          </div>
          {many && (
            <p className="text-xs text-muted-foreground">Also printing: {sales.slice(1).map(s => s.invoiceNumber).join(", ")}</p>
          )}
        </div>
      </Modal>

      {/* Directly under <body>, so printing shows only the receipts. */}
      {open && typeof document !== "undefined" && createPortal(
        <div className="receipt-print-root">
          <style>{PAGE_RULES[paper]}</style>
          {sales.map((sale, i) => (
            <div
              key={sale.invoiceNumber}
              style={{
                breakAfter: i < sales.length - 1 ? "page" : undefined,
                padding: paper === "a4" ? "12mm" : undefined,
              }}
            >
              <SaleReceipt sale={sale} store={store} />
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
