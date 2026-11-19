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
    <html lang="en">
      <body className="min-h-screen bg-white text-[#333333] font-sans antialiased">
        <div className="min-h-screen flex bg-white">
          <aside
            aria-label="Sidebar"
            className="w-14 shrink-0 sticky top-0 h-screen bg-white flex flex-col items-center py-6 select-none"
          >
            <SiteNav />
          </aside>
          <main className="flex-1 min-w-0 max-w-6xl mx-auto px-4 sm:px-8 py-6 bg-white">
            <div className="flex justify-end mb-6">
              <SystemStatusPill />
            </div>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
