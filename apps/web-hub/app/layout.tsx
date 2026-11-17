import type { Metadata } from "next";
import { SiteNav } from "../components/SiteNav";
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
    <html lang="en" >
      <body className="min-h-screen bg-white text-[#333333] font-sans antialiased">
        <header className="border-b border-[#cccccc] bg-white sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 min-h-16 py-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-3">
              <span className="text-xl font-bold text-[#333333]">
                PolyPost
              </span>
              <SystemStatusPill />
            </div>
            <SiteNav />
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
