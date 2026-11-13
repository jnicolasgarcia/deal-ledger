import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { NoAccessPanel } from "@/app/_components/no-access-panel";
import { PageViewLogger } from "@/app/_components/page-view-logger";
import { FEED_LIMIT, loadActivity, loadAdminUsers, type AdminUser } from "@/lib/admin-server";
import { describeActivity, formatDateTime } from "@/lib/activity";
import { UsersTable } from "./users-table";
import { FeedFilter } from "./feed-filter";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function ErrorCard({ title }: { title: string }) {
  return (
    <div role="alert" className="rounded-lg bg-surface p-6 shadow-card">
      <p className="text-headline">{title}</p>
      <p className="mt-1 text-callout text-ink-secondary">Refresh the page to try again.</p>
    </div>
  );
}

async function AdminContent({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  if (user.role !== "admin") return <NoAccessPanel user={user} area="Admin" allowed="admins" />;

  const [result, params] = await Promise.all([loadAdminUsers(), searchParams]);
  if ("error" in result) return <ErrorCard title="Couldn't load users" />;
  const { users } = result;

  const requested = typeof params.user === "string" ? params.user : null;
  const filterUser = requested && UUID.test(requested) && users.some((u) => u.user_id === requested) ? requested : null;

  return (
    <div className="flex flex-col gap-section">
      <section className="flex flex-col gap-3" aria-labelledby="users-heading">
        <div className="flex items-baseline gap-2">
          <h1 id="users-heading" className="text-title-2">Users</h1>
          <span className="text-callout text-ink-secondary">{users.length}</span>
        </div>
        <p className="-mt-1 text-footnote text-ink-secondary">
          Role changes apply on the user&apos;s next page load. Your own role can only be changed by another admin. New users are added with a script, not here.
        </p>
        {users.length === 0 ? (
          <div className="rounded-lg bg-surface p-6 text-callout text-ink-secondary shadow-card">No users yet.</div>
        ) : (
          <UsersTable
            currentUserId={user.id}
            users={users.map((u) => ({
              user_id: u.user_id,
              name: u.name,
              email: u.email,
              role: u.role,
              lastLogin: formatDateTime(u.last_login_at),
              edits7d: u.edits_7d,
            }))}
          />
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="activity-heading">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="activity-heading" className="text-title-3">Activity</h2>
          <FeedFilter users={users.map((u) => ({ id: u.user_id, name: u.name }))} value={filterUser} />
        </div>
        <Suspense key={filterUser ?? "all"} fallback={<FeedSkeleton />}>
          <ActivityFeed users={users} userId={filterUser} />
        </Suspense>
      </section>
    </div>
  );
}

async function ActivityFeed({ users, userId }: { users: AdminUser[]; userId: string | null }) {
  const feed = await loadActivity(userId);
  if ("error" in feed) return <ErrorCard title="Couldn't load activity" />;
  if (feed.rows.length === 0) {
    return (
      <div className="rounded-lg bg-surface p-6 text-callout text-ink-secondary shadow-card">
        {userId ? "No activity for this user yet." : "No activity yet."}
      </div>
    );
  }

  const names = new Map(users.map((u) => [u.user_id, u.name]));
  return (
    <div className="flex flex-col gap-2">
      <ol className="overflow-hidden rounded-lg bg-surface shadow-card">
        {feed.rows.map((row) => (
          <li key={row.id} className="flex min-h-row items-center gap-3 border-b border-hairline px-3 py-1.5 text-callout last:border-0 even:bg-surface-muted">
            <time dateTime={row.created_at} className="w-32 shrink-0 whitespace-nowrap tabular-nums text-ink-secondary">
              {formatDateTime(row.created_at)}
            </time>
            <span className="w-44 shrink-0 truncate font-medium text-ink">
              {(row.user_id && names.get(row.user_id)) || "Deleted user"}
            </span>
            <span className="min-w-0 flex-1 text-ink">{describeActivity(row, names, feed.deals)}</span>
            {row.is_demo && (
              <span
                className="shrink-0 rounded-sm bg-black/5 px-1.5 text-caption text-ink-secondary"
                title="Seeded demo activity, not real usage"
              >
                Demo
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="text-footnote text-ink-tertiary">
        {feed.hasMore ? `Showing the latest ${FEED_LIMIT}. ` : ""}Times are Eastern. Rows marked Demo are seeded demo activity.
      </p>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div aria-label="Loading activity" className="overflow-hidden rounded-lg bg-surface shadow-card">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-row items-center gap-3 border-b border-hairline px-3">
          <span className="h-3 w-24 animate-pulse rounded-sm bg-black/5" />
          <span className="h-3 w-32 animate-pulse rounded-sm bg-black/5" />
          <span className="h-3 w-64 animate-pulse rounded-sm bg-black/5" />
        </div>
      ))}
    </div>
  );
}

function AdminSkeleton() {
  return (
    <div aria-label="Loading admin" className="flex flex-col gap-3">
      <span className="h-8 w-40 animate-pulse rounded-md bg-black/5" />
      <div className="overflow-hidden rounded-lg bg-surface shadow-card">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-row items-center gap-4 border-b border-hairline px-3">
            <span className="h-3 w-32 animate-pulse rounded-sm bg-black/5" />
            <span className="h-3 w-48 animate-pulse rounded-sm bg-black/5" />
            <span className="h-3 w-20 animate-pulse rounded-sm bg-black/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Users, roles and the usage log. Admins only (RLS and get_admin_users check it too). */
export default function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageViewLogger page="admin" />
      <Suspense fallback={<AdminSkeleton />}>
        <AdminContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}
