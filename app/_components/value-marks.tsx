/** Shared marks for values: unconfirmed assumptions and missing values. */

export const ASSUMPTION_TOOLTIP = "Assumption, not yet confirmed";

/** Muted placeholder for missing values. Never a blank. */
export function NotAvailable({ title, className = "" }: { title?: string; className?: string }) {
  return (
    <span className={`text-ink-tertiary ${className}`} title={title}>
      n/a
    </span>
  );
}

export function EstBadge({ size = "sm" }: { size?: "sm" | "md" }) {
  return (
    <span
      className={`shrink-0 rounded-[4px] bg-warning-soft px-1 font-medium not-italic text-warning ${
        size === "md" ? "text-[13px] leading-5" : "text-[11px] leading-4"
      }`}
    >
      est.
    </span>
  );
}

/** Italic, secondary color, "est." badge: a value entered before confirmed data existed. */
export function Assumption({
  children,
  align = "left",
  size = "sm",
  inline = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  size?: "sm" | "md";
  inline?: boolean;
}) {
  return (
    <span
      title={ASSUMPTION_TOOLTIP}
      className={`${inline ? "inline-flex" : "flex min-w-0"} items-center gap-1.5 italic text-ink-secondary ${
        align === "right" ? "justify-end" : ""
      }`}
    >
      <span className={inline ? "" : "truncate"}>{children}</span>
      <EstBadge size={size} />
    </span>
  );
}
