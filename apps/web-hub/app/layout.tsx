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
      <body className="min-h-dvh bg-white text-[#333333] font-sans antialiased">
        <div className="min-h-dvh flex bg-white">
          <aside
            aria-label="Sidebar"
            className="w-[50px] shrink-0 sticky top-0 h-dvh bg-white flex flex-col items-center p-[5px] select-none border-0 outline-none shadow-none"
          >
            <SiteNav />
          </aside>
          <main className="flex-1 min-w-0 py-[5px] pr-[5px] pl-0 bg-white space-y-[5px]">
            <div className="flex justify-end">
              <SystemStatusPill />
            </div>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
