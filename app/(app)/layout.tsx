import { TopBar } from "@/app/_components/top-bar";

// Shell for every signed-in page. proxy.ts redirects signed-out visitors;
// UserMenu re-checks the session on the server.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full">
      <TopBar />
      <main className="mx-auto max-w-[1440px] px-gutter py-6 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
