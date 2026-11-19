"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import { prefetchRoute } from "@/lib/prefetch";

/**
 * Notes live in the top bar rather than the main navigation: they're a side
 * tool (an order jotted down in a rush, a plan), one tap away from any page.
 * Computers show the word too; phones and tablets show the icon.
 */
export function NotesButton() {
  const pathname = usePathname();
  const active = pathname === "/notes" || pathname.startsWith("/notes/");

  return (
    <Link
      href="/notes"
      aria-label="Notes"
      title="Notes"
      aria-current={active ? "page" : undefined}
      onMouseEnter={() => prefetchRoute("/notes")}
      onTouchStart={() => prefetchRoute("/notes")}
      className={cn(
        "flex items-center justify-center gap-1.5 w-10 h-10 sm:w-8 sm:h-8 lg:w-auto lg:px-2.5 rounded-lg border transition-colors shrink-0",
        active
          ? "border-primary/30 bg-primary/5 text-primary dark:text-pink-300"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <NotebookPen size={15} />
      <span className="hidden lg:inline text-xs font-semibold">Notes</span>
    </Link>
  );
}
