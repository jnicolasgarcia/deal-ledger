"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Toast, type ToastMessage } from "@/app/_components/toast";
import { changeUserRole } from "./actions";

export type UserView = {
  user_id: string;
  name: string;
  email: string | null;
  role: "admin" | "editor" | "viewer" | null;
  lastLogin: string | null; // formatted on the server
  edits7d: number;
};

const OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
  { value: "", label: "No access" },
] as const;

function RoleSelect({
  user,
  onResult,
}: {
  user: UserView;
  onResult: (t: Omit<ToastMessage, "id">) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(user.role ?? "");

  function change(next: string) {
    const label = OPTIONS.find((o) => o.value === next)?.label ?? next;
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const res = await changeUserRole(user.user_id, next || null);
      if (!res.ok) {
        setValue(previous);
        onResult({ kind: "error", text: res.error });
        return;
      }
      onResult({ kind: "success", text: `${user.name} is now ${label === "No access" ? "without access" : label}.` });
      router.refresh(); // reload the feed, which now shows the change
    });
  }

  return (
    <label className="relative inline-flex">
      <span className="sr-only">Role for {user.name}</span>
      <select
        value={value}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        className={`h-7 appearance-none rounded-sm border border-separator bg-surface pr-7 pl-2 text-callout outline-none focus:border-accent focus:shadow-focus disabled:opacity-60 ${
          value === "" ? "text-warning" : "text-ink"
        }`}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg aria-hidden width="10" height="10" viewBox="0 0 10 10" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 opacity-60">
        <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </label>
  );
}

/** Users with their role (changeable), last sign-in and edits in the last 7 days. */
export function UsersTable({ users, currentUserId }: { users: UserView[]; currentUserId: string }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const show = useCallback((t: Omit<ToastMessage, "id">) => setToast({ ...t, id: Date.now() }), []);
  const dismiss = useCallback(() => setToast(null), []);

  return (
    <>
      <div className="overflow-x-auto rounded-lg bg-surface shadow-card">
        <table className="w-full min-w-[720px] text-left text-callout">
          <thead className="border-b border-hairline text-footnote text-ink-secondary">
            <tr className="h-row">
              <th scope="col" className="px-3 font-medium">Name</th>
              <th scope="col" className="px-3 font-medium">Email</th>
              <th scope="col" className="px-3 font-medium">Role</th>
              <th scope="col" className="px-3 font-medium">Last sign-in</th>
              <th scope="col" className="px-3 text-right font-medium">Edits, last 7 days</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id} className="h-row border-b border-hairline last:border-0 even:bg-surface-muted">
                <td className="px-3 font-medium text-ink">
                  {u.name}
                  {u.user_id === currentUserId && <span className="ml-1.5 text-footnote font-normal text-ink-tertiary">(you)</span>}
                </td>
                <td className="px-3 text-ink-secondary">{u.email ?? <span className="text-ink-tertiary">n/a</span>}</td>
                <td className="px-3 py-1">
                  {u.user_id === currentUserId ? (
                    // The database refuses changes to your own role (008); another admin has to do it.
                    <span className="inline-flex h-7 items-center pl-2 text-ink" title="Another admin has to change your role">
                      {OPTIONS.find((o) => o.value === (u.role ?? ""))?.label}
                    </span>
                  ) : (
                    <RoleSelect user={u} onResult={show} />
                  )}
                </td>
                <td className="px-3 tabular-nums text-ink-secondary">
                  {u.lastLogin ?? (
                    <span className="text-ink-tertiary" title="No sign-in recorded since usage logging started">n/a</span>
                  )}
                </td>
                <td className="px-3 text-right tabular-nums">{u.edits7d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Toast toast={toast} onDismiss={dismiss} />
    </>
  );
}
