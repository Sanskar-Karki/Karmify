"use client";

import React, { useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Printer, Tag } from "lucide-react";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { Dropdown } from "@/components/shared/Dropdown";
import { Barcode } from "@/components/shared/Barcode";
import { formatNPR } from "@/lib/utils";
import { deliveryAddress, itemName } from "@/lib/orders";
import type { StoreProfile } from "@/lib/storeProfile";

type Paper = "label" | "a4";

const PAPER_OPTIONS = [
  { value: "label", label: "Label printer (100 × 150 mm)" },
  { value: "a4", label: "A4 paper" },
];

const PAGE_RULES: Record<Paper, string> = {
  label: "@media print { @page { size: 100mm 150mm; margin: 0; } }",
  // No page margin, so the browser can't add its own header/footer (title, address); the label is padded instead.
  a4: "@media print { @page { size: A4; margin: 0; } }",
};

const PAPER_STORAGE_KEY = "karmify_label_paper";

function readSavedPaper(): Paper {
  try {
    return localStorage.getItem(PAPER_STORAGE_KEY) === "a4" ? "a4" : "label";
  } catch {
    return "label";
  }
}

export interface LabelOrder {
  invoiceNumber: string;
  createdAt: Date | string;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customer?: { code: string } | null;
  paymentMethod: "COD" | "QR";
  codAmount: number;
  totalAmount: number;
  items: { id: string; quantity: number; variant?: string | null; product: { name: string } }[];
}

// Pure black on white at true print size, so the preview matches the paper and
// thermal printers get clean edges. Theme colours are deliberately not used.
function CustomerLabel({ order, store, outlined }: { order: LabelOrder; store: StoreProfile; outlined: boolean }) {
  const senderDetails = [store.address, store.phone].filter(Boolean).join(" · ");
  const pieces = order.items.reduce((total, item) => total + item.quantity, 0);
  const customerCode = order.customer?.code;
  const address = deliveryAddress(order.customerAddress);
  // Website imports don't record a COD amount; the order total is what's due.
  const cashToCollect = order.codAmount || order.totalAmount;

  return (
    <div
      className="flex flex-col bg-white text-black overflow-hidden shrink-0"
      style={{ width: "100mm", height: "149.5mm", padding: "5mm", boxSizing: "border-box", outline: outlined ? "1px solid #000" : undefined }}
    >
      <div className="border-b-2 border-black pb-2">
        <p className="text-[8pt] font-bold uppercase tracking-wider">From</p>
        <p className="text-[12pt] font-bold leading-tight">{store.name}</p>
        {senderDetails && <p className="text-[9pt] leading-snug">{senderDetails}</p>}
      </div>

      <div className="py-3 border-b-2 border-black min-h-0">
        <p className="text-[8pt] font-bold uppercase tracking-wider">Deliver to</p>
        <p className="text-[19pt] font-extrabold leading-tight line-clamp-2 break-words">{order.customerName ?? "Walk-in Customer"}</p>
        {order.customerPhone && <p className="text-[15pt] font-bold leading-snug mt-1">{order.customerPhone}</p>}
        {address && <p className="text-[12pt] leading-snug mt-1 line-clamp-4 break-words">{address}</p>}
      </div>

      <div className="my-3 border-2 border-black px-3 py-2 text-center">
        {order.paymentMethod === "COD" ? (
          <>
            <p className="text-[9pt] font-bold uppercase tracking-wider">Cash to collect</p>
            <p className="text-[22pt] font-extrabold leading-tight">{formatNPR(cashToCollect)}</p>
          </>
        ) : (
          <>
            <p className="text-[16pt] font-extrabold leading-tight">PAID</p>
            <p className="text-[9pt] font-bold uppercase tracking-wider">Do not collect cash</p>
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <p className="text-[8pt] font-bold uppercase tracking-wider">
          Items · {order.items.length} {order.items.length === 1 ? "product" : "products"} · {pieces} {pieces === 1 ? "piece" : "pieces"}
        </p>
        {/* Lines that don't fit wrap into a hidden second column, so a line is never cut in half. */}
        <div data-testid="label-items" className="flex-1 min-h-0 flex flex-col flex-wrap overflow-hidden">
          {order.items.map(item => (
            <p key={item.id} className="w-full text-[10pt] leading-snug line-clamp-2 break-words">{item.quantity} × {itemName(item)}</p>
          ))}
        </div>
      </div>

      <div className="border-t-2 border-black pt-2">
        {customerCode && (
          <div className="mb-2">
            <Barcode value={customerCode} />
            <p className="text-center text-[11pt] font-bold font-mono leading-none mt-1">{customerCode}</p>
          </div>
        )}
        <div className="flex items-end justify-between gap-2">
          <p className="text-[11pt] font-bold font-mono leading-none">{order.invoiceNumber}</p>
          <p className="text-[9pt] leading-none shrink-0">{new Date(order.createdAt).toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  );
}

interface CustomerLabelDialogProps {
  open: boolean;
  onClose: () => void;
  /** One order, or several to print one label per page. */
  order?: LabelOrder;
  orders?: LabelOrder[];
  store: StoreProfile;
}

/** Shows the customer's delivery label as it will print, scaled to fit the screen, with print as the final step. */
export function CustomerLabelDialog({ open, onClose, order, orders, store }: CustomerLabelDialogProps) {
  const [paper, setPaper] = useState<Paper>(readSavedPaper);
  const list = orders ?? (order ? [order] : []);
  const first = list[0];

  function changePaper(value: string) {
    const next = value as Paper;
    setPaper(next);
    try {
      localStorage.setItem(PAPER_STORAGE_KEY, next);
    } catch {
      // Private browsing: the choice still applies for this label.
    }
  }

  const missingSender = !store.address && !store.phone;
  if (!first) return null;
  const many = list.length > 1;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={many ? `${list.length} customer labels` : "Customer label preview"}
        description={many ? "One label per page. The first is shown below." : `Check the details for ${first.invoiceNumber} before printing`}
        icon={Tag}
        footer={
          <>
            <Button variant="secondary" onClick={onClose} className="flex-1">
              <ArrowLeft size={14} /> Back
            </Button>
            <Button onClick={() => window.print()} className="flex-1" data-autofocus>
              <Printer size={14} /> {many ? `Print ${list.length} Labels` : "Print Label"}
            </Button>
          </>
        }
      >
        <div className="p-4 sm:p-5 space-y-3">
          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Paper</span>
            <Dropdown aria-label="Paper" value={paper} onChange={changePaper} options={PAPER_OPTIONS} />
          </div>

          {missingSender && (
            <p className="text-xs text-muted-foreground">
              Add your store address and phone in Settings to show them on labels.
            </p>
          )}

          <div className="flex justify-center rounded-xl bg-muted p-3 overflow-hidden">
            <div data-testid="label-preview" className="shadow-lg max-[420px]:[zoom:0.82] max-[350px]:[zoom:0.7] [@media(max-height:1000px)]:[zoom:0.85] [@media(max-height:820px)]:[zoom:0.68] [@media(max-height:700px)]:[zoom:0.55]">
              <CustomerLabel order={first} store={store} outlined={paper === "a4"} />
            </div>
          </div>
          {many && (
            <p className="text-xs text-muted-foreground">
              Also printing: {list.slice(1).map(o => o.invoiceNumber).join(", ")}
            </p>
          )}
        </div>
      </Modal>

      {/* Sits directly under <body> so printing isn't clipped by the dialog's scroll area. */}
      {open && typeof document !== "undefined" && createPortal(
        <div className="label-print-root">
          <style>{PAGE_RULES[paper]}</style>
          {list.map((o, i) => (
            // Each label on its own page.
            <div key={o.invoiceNumber} style={{ breakAfter: i < list.length - 1 ? "page" : undefined, padding: paper === "a4" ? "10mm" : undefined }}>
              <CustomerLabel order={o} store={store} outlined={paper === "a4"} />
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
