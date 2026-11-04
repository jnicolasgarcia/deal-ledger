import { ROLE_LABELS, type AppRole } from "@/lib/auth";

const STYLES: Record<AppRole, string> = {
  admin: "bg-accent-soft text-accent",
  editor: "bg-[#E3F4F3] text-[#0E6E69]",
  viewer: "bg-black/5 text-ink-secondary",
};

/** The signed-in user's role as a small label. */
export function RoleBadge({ role }: { role: AppRole | null }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-caption font-medium ${
        role ? STYLES[role] : "bg-warning-soft text-warning"
      }`}
    >
      {role ? ROLE_LABELS[role] : "No access"}
    </span>
  );
}
