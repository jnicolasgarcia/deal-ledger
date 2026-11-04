import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { NoAccessPanel } from "@/app/_components/no-access-panel";

async function AdminContent() {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccessPanel user={user} area="Admin" allowed="admins" />;
  return (
    <section>
      <h1 className="text-title-2">Admin</h1>
      <div className="mt-4 rounded-lg bg-surface p-6 text-callout text-ink-secondary shadow-card">
        Users, roles and usage logs come in a later step.
      </div>
    </section>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<span className="block h-8 w-40 animate-pulse rounded-md bg-black/5" />}>
      <AdminContent />
    </Suspense>
  );
}
