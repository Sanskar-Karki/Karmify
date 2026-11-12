import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export function Pulse({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={cn("skeleton-shimmer rounded", className)} style={style} />;
}
