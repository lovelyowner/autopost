import type { Metadata } from "next";
import { SiteNav } from "../components/SiteNav";
import { UI_SETTINGS_INIT_SCRIPT } from "../lib/ui-settings";
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <script dangerouslySetInnerHTML={{ __html: UI_SETTINGS_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-white text-[#333333] font-sans antialiased">
        <div className="min-h-dvh flex bg-white">
          <aside
            aria-label="Sidebar"
            className="w-[40px] shrink-0 sticky top-0 h-dvh bg-white flex flex-col items-center p-[5px] select-none border-0 outline-none shadow-none"
          >
            <SiteNav />
          </aside>
          <main className="flex-1 min-w-0 bg-white space-y-0 p-0">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
