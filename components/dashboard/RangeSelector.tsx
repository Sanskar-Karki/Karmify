"use client";

// The dashboard's period picker: today / week / month / year, or a custom range.

import React, { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover } from "@/components/shared/Popover";

export type RangeKey = "today" | "week" | "month" | "year" | "custom";

// Calendar days are handled as local "YYYY-MM-DD" strings. Going through
// toISOString() or new Date("YYYY-MM-DD") shifts them by the UTC offset, which
// in Nepal selects the previous day.
export function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

const shortDate = (key: string) => parseDateKey(key).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function buildBuckets(range: RangeKey, customStart?: Date, customEnd?: Date) {
  const now = new Date();
  if (range === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return [{ label: "Today", start, end }];
  }
  if (range === "week") {
    return Array.from({ length: 7 }).map((_, i) => {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - i));
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      return { label: start.toLocaleDateString("en-US", { weekday: "short" }), start, end };
    });
  }
  if (range === "month") {
    return Array.from({ length: 30 }).map((_, i) => {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (29 - i));
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      return { label: start.toLocaleDateString("en-US", { day: "2-digit", month: "short" }), start, end };
    });
  }
  if (range === "custom" && customStart && customEnd) {
    return [{ label: "Custom", start: customStart, end: new Date(customEnd.getFullYear(), customEnd.getMonth(), customEnd.getDate() + 1) }];
  }
  return Array.from({ length: 12 }).map((_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { label: start.toLocaleDateString("en-US", { month: "short" }), start, end };
  });
}

export function RangeSelector({ value, onChange, showCustom = false, onCustomChange }: { value: RangeKey; onChange: (r: RangeKey) => void; showCustom?: boolean; onCustomChange?: (start: Date, end: Date) => void }) {
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(new Date().getMonth());
  const [displayYear, setDisplayYear] = useState(new Date().getFullYear());
  const customButtonRef = useRef<HTMLButtonElement>(null);

  const handleDateSelect = (dateStr: string) => {
    if (!customStart) {
      // First click - set start date
      setCustomStart(dateStr);
    } else if (!customEnd) {
      // Second click - set end date
      if (dateStr < customStart) {
        // If end date is before start date, swap them
        setCustomEnd(customStart);
        setCustomStart(dateStr);
        if (onCustomChange) {
          onCustomChange(parseDateKey(dateStr), parseDateKey(customStart));
        }
      } else {
        // End date is after start date - all good
        setCustomEnd(dateStr);
        if (onCustomChange) {
          onCustomChange(parseDateKey(customStart), parseDateKey(dateStr));
        }
      }
      setShowPicker(false);
    } else {
      // Both dates already selected - reset and start over
      setCustomStart(dateStr);
      setCustomEnd("");
    }
  };

  const handlePickerClose = () => {
    if (customStart && customEnd && onCustomChange) {
      onCustomChange(parseDateKey(customStart), parseDateKey(customEnd));
    }
    setShowPicker(false);
    const now = new Date();
    setDisplayMonth(now.getMonth());
    setDisplayYear(now.getFullYear());
  };

  const generateCalendarDays = () => {
    const firstDay = new Date(displayYear, displayMonth, 1);
    const lastDay = new Date(displayYear, displayMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    const days = [];

    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(displayYear, displayMonth, i));
    }
    return days;
  };

  const handlePrevMonth = () => {
    if (displayMonth === 0) {
      setDisplayMonth(11);
      setDisplayYear(displayYear - 1);
    } else {
      setDisplayMonth(displayMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (displayMonth === 11) {
      setDisplayMonth(0);
      setDisplayYear(displayYear + 1);
    } else {
      setDisplayMonth(displayMonth + 1);
    }
  };

  return (
    <div className="flex items-center gap-2 bg-muted p-1 rounded-lg border border-border shrink-0 flex-wrap relative">
      {(["today", "week", "month", "year"] as const).map(r => (
        <button
          key={r}
          onClick={() => {
            onChange(r);
            setCustomStart("");
            setCustomEnd("");
            setShowPicker(false);
          }}
          className={cn(
            "px-2.5 py-1 rounded-md text-[11px] font-bold uppercase transition-colors cursor-pointer",
            value === r ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {r}
        </button>
      ))}
      {showCustom && (
        <>
          <button
            ref={customButtonRef}
            onClick={() => {
              onChange("custom");
              setShowPicker(!showPicker);
            }}
            className={cn(
              "px-2.5 py-1 rounded-md text-[11px] font-bold uppercase transition-colors cursor-pointer",
              value === "custom" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Custom
          </button>

          {value === "custom" && (
            <div className="text-[11px] text-muted-foreground px-2 py-1 bg-card rounded-md">
              {customStart && customEnd
                ? `${shortDate(customStart)} - ${shortDate(customEnd)}`
                : customStart
                  ? `From ${shortDate(customStart)}`
                  : "Pick dates"}
            </div>
          )}

          {value === "custom" && (
            <Popover
              open={showPicker}
              onClose={handlePickerClose}
              anchorRef={customButtonRef}
              align="end"
              className="bg-popover text-popover-foreground border border-border rounded-xl shadow-xl p-4 w-[calc(100vw-1rem)] max-w-72"
            >
              <div className="space-y-3">
                    <div className="text-center">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={handlePrevMonth}
                          className="p-1 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground"
                          aria-label="Previous month"
                        >
                          <ChevronLeft size={15} />
                        </button>
                        <p className="text-xs font-bold text-foreground flex-1 text-center">
                          {new Date(displayYear, displayMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                        </p>
                        <button
                          onClick={handleNextMonth}
                          className="p-1 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-foreground"
                          aria-label="Next month"
                        >
                          <ChevronRight size={15} />
                        </button>
                      </div>
                      <div className="text-[11px] font-medium space-y-1">
                        {!customStart ? (
                          <p className="text-muted-foreground">Select a start date</p>
                        ) : !customEnd ? (
                          <div className="text-primary space-y-1">
                            <p>Start: {shortDate(customStart)}</p>
                            <p className="text-muted-foreground">Now select an end date</p>
                          </div>
                        ) : (
                          <p className="text-emerald-600 dark:text-emerald-400">
                            {shortDate(customStart)} - {shortDate(customEnd)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
                        <div key={day} className="text-center text-[11px] font-semibold text-muted-foreground h-6 flex items-center justify-center">
                          {day}
                        </div>
                      ))}
                      {generateCalendarDays().map((date, idx) => {
                        const dateStr = date ? toDateKey(date) : "";
                        const isStart = dateStr === customStart;
                        const isEnd = dateStr === customEnd;
                        const isInRange = Boolean(dateStr && customStart && customEnd && dateStr >= customStart && dateStr <= customEnd);

                        return (
                          <button
                            key={idx}
                            type="button"
                            aria-label={date ? date.toDateString() : undefined}
                            aria-pressed={isStart || isEnd || isInRange}
                            onClick={() => date && handleDateSelect(dateStr)}
                            disabled={!date}
                            className={cn(
                              "h-7 rounded text-[11px] font-medium transition-all cursor-pointer disabled:cursor-default",
                              !date ? "invisible" : "",
                              isStart || isEnd ? "bg-primary text-primary-foreground shadow-md" : "",
                              isInRange && !isStart && !isEnd ? "bg-primary/20 text-foreground" : "",
                              !isStart && !isEnd && !isInRange ? "hover:bg-muted text-foreground" : ""
                            )}
                          >
                            {date?.getDate()}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => {
                          setCustomStart("");
                          setCustomEnd("");
                        }}
                        className="flex-1 px-2 py-1.5 rounded text-[11px] font-semibold border border-border/60 text-foreground hover:bg-muted transition-colors"
                      >
                        Clear
                      </button>
                      <button
                        onClick={handlePickerClose}
                        disabled={!customStart || !customEnd}
                        className="flex-1 px-2 py-1.5 rounded text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {!customStart ? "Select dates" : !customEnd ? "Select end" : "Done"}
                      </button>
                    </div>
                  </div>
            </Popover>
          )}
        </>
      )}
    </div>
  );
}
