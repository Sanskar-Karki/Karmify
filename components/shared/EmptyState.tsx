import React from "react";
import { LucideIcon, Inbox } from "lucide-react";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Render inside a table cell that spans the given column count. */
  colSpan?: number;
  className?: string;
};

function Body({ icon: Icon = Inbox, title, description, action }: Omit<EmptyStateProps, "colSpan" | "className">) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center mb-3">
        <Icon size={22} className="text-muted-foreground/60" />
      </div>
      <p className="font-semibold text-sm text-foreground">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground mt-1 max-w-xs">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Consistent, quiet empty state used across the dashboard. Pass `colSpan` to
 * render it as a full-width table row; otherwise it renders as a block.
 */
export function EmptyState({ colSpan, className, ...props }: EmptyStateProps) {
  if (colSpan !== undefined) {
    return (
      <tr>
        <td colSpan={colSpan} className={className}>
          <Body {...props} />
        </td>
      </tr>
    );
  }
  return (
    <div className={className}>
      <Body {...props} />
    </div>
  );
}
