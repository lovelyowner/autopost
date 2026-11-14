import type { Metadata } from "next";
import Link from "next/link";
import { SystemStatusPill } from "../components/SystemStatusPill";
import "./globals.css";

export const metadata: Metadata = {
  title: "PolyPost - Unified Multi-Engine Autoposting Hub",
  description: "Polymorphic multi-engine autoposting monorepo across 125+ networks",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 font-sans antialiased">
        <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <span className="text-xl font-bold bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400 bg-clip-text text-transparent">
                PolyPost
              </span>
              <SystemStatusPill />
            </div>
            <nav className="flex space-x-6 text-sm font-medium">
              <Link href="/" className="hover:text-blue-400 transition-colors">
                Composer & Funnel
              </Link>
              <Link
                href="/vault"
                className="px-2.5 py-1 rounded-md bg-emerald-950/70 border border-emerald-700/80 text-emerald-300 hover:bg-emerald-900/80 transition-colors"
              >
                Connect Accounts / Vault
              </Link>
              <Link href="/presets" className="hover:text-blue-400 transition-colors">
                2257 / Pricing Presets
              </Link>
              <Link href="/calendar" className="hover:text-blue-400 transition-colors">
                Calendar &amp; Bulk CSV
              </Link>
              <Link href="/history" className="hover:text-blue-400 transition-colors">
                Campaign History
              </Link>
            </nav>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
