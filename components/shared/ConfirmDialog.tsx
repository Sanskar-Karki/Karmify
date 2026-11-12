"use client";

import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  /** Awaited with the dialog locked; the caller closes it when finished. */
  onConfirm: () => Promise<void> | void;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Extra options shown under the description. */
  children?: React.ReactNode;
}

/** Confirmation for destructive actions. Focus starts on the safe choice. */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, cancelLabel = "Cancel", children }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" busy={busy} hideHeader>
      <div className="p-5 sm:p-6 space-y-5" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-base text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
            {children}
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} disabled={busy} className="flex-1" data-autofocus>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={confirm} loading={busy} className="flex-1">
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
