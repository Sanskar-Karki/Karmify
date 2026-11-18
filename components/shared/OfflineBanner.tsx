"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";
import { toast } from "sonner";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
const readOnline = () => navigator.onLine;
const serverOnline = () => true;

/**
 * A slim bar under the top bar while the phone or computer has no connection.
 * Pages already opened still show what was loaded, so this says why nothing
 * saves. When the connection is back, the bar goes and a short toast says so
 * (the pages refresh their data by themselves, see useResources).
 */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, readOnline, serverOnline);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
    } else if (wasOffline.current) {
      wasOffline.current = false;
      toast.success("Back online.", { id: "connection", duration: 2500 });
    }
  }, [online]);

  return (
    <div role="status" className="shrink-0">
      {!online && (
        <p className="flex items-center justify-center gap-2 border-b border-amber-300/60 bg-amber-50 px-3 py-1.5 text-center text-xs font-semibold text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/50 dark:text-amber-200">
          <WifiOff size={14} className="shrink-0" aria-hidden />
          You&apos;re offline. You can look around, but changes won&apos;t save until you reconnect.
        </p>
      )}
    </div>
  );
}
