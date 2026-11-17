"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Composer & Funnel" },
  { href: "/vault", label: "Connect Accounts / Vault" },
  { href: "/presets", label: "Templates & Presets" },
  { href: "/calendar", label: "Calendar & Bulk CSV" },
  { href: "/history", label: "Campaign History" },
  { href: "/plans", label: "Plans & Crypto" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      {NAV_ITEMS.map((item) => {
        const isCurrent = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isCurrent ? "page" : undefined}
            className={`no-underline transition-colors ${
              isCurrent
                ? "font-bold text-[#333333]"
                : "font-medium text-[#666666] hover:font-bold hover:text-[#333333]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
