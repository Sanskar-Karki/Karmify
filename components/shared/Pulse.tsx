import { cn } from "@/lib/utils";

export function Pulse({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-muted rounded", className)} />;
}
