import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { BfcacheGuard } from "./_components/bfcache-guard";

// Fallback only: Apple devices use SF Pro through -apple-system (see globals.css).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Deal Ledger",
  description: "Site search pipeline for the acquisitions team.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full">
        <BfcacheGuard />
        {children}
      </body>
    </html>
  );
}
