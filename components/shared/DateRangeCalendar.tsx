"use client";

import { useState, type RefObject } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Popover } from "@/components/shared/Popover";
import { cn } from "@/lib/utils";

// Days are local "YYYY-MM-DD" keys: going through toISOString() would shift
// them by Nepal's UTC offset and select the day before.
export const toDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const fromDateKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const shortDay = (key: string) => fromDateKey(key).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/**
 * A calendar to pick a start and an end day. The first click sets the start,
 * the second the end (either order); days after today can't be picked.
 */
export function DateRangeCalendar({
  open,
  onClose,
  anchorRef,
  initialStart,
  initialEnd,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  initialStart?: string;
  initialEnd?: string;
  onApply: (start: string, end: string) => void;
}) {
  const today = toDateKey(new Date());
  const [start, setStart] = useState(initialStart ?? "");
  const [end, setEnd] = useState(initialEnd ?? "");
  const [hover, setHover] = useState("");
  const shown = fromDateKey(initialEnd ?? today);
  const [month, setMonth] = useState(new Date(shown.getFullYear(), shown.getMonth(), 1));

  const pick = (key: string) => {
    if (!start || end) {
      setStart(key);
      setEnd("");
    } else if (key < start) {
      setEnd(start);
      setStart(key);
    } else {
      setEnd(key);
    }
  };
  const shift = (by: number) => setMonth(m => new Date(m.getFullYear(), m.getMonth() + by, 1));
  const atThisMonth = month.getFullYear() === new Date().getFullYear() && month.getMonth() === new Date().getMonth();

  // Weeks start on Monday.
  const lead = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => toDateKey(new Date(month.getFullYear(), month.getMonth(), i + 1))),
  ];
  // While choosing the end, the range follows the mouse.
  const rangeEnd = end || (start && hover > start ? hover : "");

  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      align="end"
      className="w-[calc(100vw-1rem)] max-w-[19rem] rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
    >
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
          <ChevronLeft size={16} />
        </button>
        <p className="text-sm font-bold text-foreground">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</p>
        <button type="button" onClick={() => shift(1)} disabled={atThisMonth} aria-label="Next month" className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent">
          <ChevronRight size={16} />
        </button>
      </div>

      <p className="mt-1 text-center text-[12px] text-muted-foreground" aria-live="polite">
        {!start ? "Pick the first day" : !end ? `From ${shortDay(start)} · now pick the last day` : `${shortDay(start)} – ${shortDay(end)}`}
      </p>

      <div className="mt-3 grid grid-cols-7 gap-y-1 text-center" onMouseLeave={() => setHover("")}>
        {WEEKDAYS.map(d => (
          <span key={d} className="pb-1 text-[11px] font-semibold text-muted-foreground">{d}</span>
        ))}
        {cells.map((key, i) => {
          if (!key) return <span key={`blank-${i}`} />;
          const future = key > today;
          const isEdge = key === start || key === rangeEnd;
          const inRange = Boolean(start && rangeEnd && key > start && key < rangeEnd);
          return (
            <button
              key={key}
              type="button"
              disabled={future}
              onClick={() => pick(key)}
              onMouseEnter={() => setHover(key)}
              aria-label={fromDateKey(key).toDateString()}
              aria-pressed={isEdge || inRange}
              className={cn(
                "h-8 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:text-muted-foreground/40",
                isEdge ? "rounded-lg bg-primary font-bold text-primary-foreground" : inRange ? "bg-primary/15 text-foreground" : "rounded-lg text-foreground hover:bg-muted",
                key === today && !isEdge && "font-bold text-primary",
              )}
            >
              {fromDateKey(key).getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => { setStart(""); setEnd(""); }}
          className="flex-1 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted"
        >
          Clear
        </button>
        <button
          type="button"
          disabled={!start}
          onClick={() => onApply(start, end || start)}
          className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {start && !end ? "Just this day" : "Apply"}
        </button>
      </div>
    </Popover>
  );
}
