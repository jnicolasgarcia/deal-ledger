import { stageMeta } from "@/lib/stages";

type Props = {
  stage: string | null | undefined;
  /** sm: dense grid rows. md: weekly view and default. */
  size?: "sm" | "md";
  className?: string;
};

/** A stage label with its color. Always shows the label; it is not a button. */
export function StagePill({ stage, size = "md", className = "" }: Props) {
  const s = stageMeta(stage);
  const sizing =
    size === "sm"
      ? "h-5 gap-1 px-2 text-caption font-medium"
      : "h-7 gap-1.5 px-3 text-callout font-medium";

  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border ${sizing} ${className}`}
      style={{ backgroundColor: s.bg, color: s.text, borderColor: s.border }}
      data-stage={s.id}
    >
      <span
        aria-hidden
        className={size === "sm" ? "size-1.5 rounded-full" : "size-2 rounded-full"}
        style={{ backgroundColor: s.dot }}
      />
      {s.label}
    </span>
  );
}
