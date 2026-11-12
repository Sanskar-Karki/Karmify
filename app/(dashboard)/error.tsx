"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/shared/Button";

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center text-center py-20 px-6 bg-card border border-border/80 rounded-2xl">
      <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-950/30 flex items-center justify-center mb-3">
        <AlertTriangle size={22} className="text-red-600 dark:text-red-400" />
      </div>
      <h2 className="font-bold text-base text-foreground">This page ran into a problem</h2>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm">
        Your saved data is safe. Try loading the page again, and if it keeps happening, refresh your browser.
      </p>
      <Button onClick={() => unstable_retry()} className="mt-4">
        <RotateCcw size={14} /> Try again
      </Button>
    </div>
  );
}
