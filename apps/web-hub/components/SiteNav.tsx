"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  CircleDollarSign,
  Clock,
  KeyRound,
  Layers,
  SquarePen,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Composer & Funnel", Icon: SquarePen },
  { href: "/vault", label: "Connect Accounts / Vault", Icon: KeyRound },
  { href: "/presets", label: "Templates & Presets", Icon: Layers },
  { href: "/calendar", label: "Calendar & Bulk CSV", Icon: Calendar },
  { href: "/history", label: "Campaign History", Icon: Clock },
  { href: "/plans", label: "Plans & Crypto", Icon: CircleDollarSign },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-col items-center gap-6 bg-white">
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const isCurrent = href === "/" ? pathname === "/" : pathname?.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            title={label}
            aria-current={isCurrent ? "page" : undefined}
            className="p-1.5 bg-white transition-transform hover:scale-110 focus-visible:scale-110"
          >
            <Icon
              aria-hidden="true"
              strokeWidth={isCurrent ? 2.4 : 1.5}
              className="w-5 h-5 text-[#999999]"
            />
            <span className="sr-only">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
