import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Settings & Plans | PolyPost",
  description: "Configure interface theme, outline grid spacing, density, keyboard shortcuts, and crypto billing plans",
};

export default function SettingsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
