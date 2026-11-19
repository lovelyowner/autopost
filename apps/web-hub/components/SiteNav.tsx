"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Calendar,
  CircleDollarSign,
  Clock,
  KeyRound,
  Layers,
  type LucideIcon,
  SquarePen,
} from "lucide-react";

export interface NavItemSpec {
  href: string;
  label: string;
  shortcut: string;
  altDigit: string;
  group: "primary" | "bottom";
  Icon: LucideIcon;
}

export const NAV_ITEMS: NavItemSpec[] = [
  {
    href: "/",
    label: "Composer & Funnel",
    shortcut: "Alt+1",
    altDigit: "1",
    group: "primary",
    Icon: SquarePen,
  },
  {
    href: "/vault",
    label: "Connect Accounts / Vault",
    shortcut: "Alt+2",
    altDigit: "2",
    group: "primary",
    Icon: KeyRound,
  },
  {
    href: "/presets",
    label: "Templates & Presets",
    shortcut: "Alt+3",
    altDigit: "3",
    group: "primary",
    Icon: Layers,
  },
  {
    href: "/calendar",
    label: "Calendar & Bulk CSV",
    shortcut: "Alt+4",
    altDigit: "4",
    group: "primary",
    Icon: Calendar,
  },
  {
    href: "/history",
    label: "Campaign History",
    shortcut: "Alt+5",
    altDigit: "5",
    group: "primary",
    Icon: Clock,
  },
  {
    href: "/plans",
    label: "Plans & Crypto",
    shortcut: "Alt+6",
    altDigit: "6",
    group: "bottom",
    Icon: CircleDollarSign,
  },
];

export function SiteNav() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.isComposing || event.keyCode === 229) return;
      const hit = NAV_ITEMS.find((item) => item.altDigit === event.key);
      if (!hit) return;
      event.preventDefault();
      router.push(hit.href);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  const primaryItems = NAV_ITEMS.filter((item) => item.group === "primary");
  const bottomItems = NAV_ITEMS.filter((item) => item.group === "bottom");

  const renderItem = ({ href, label, shortcut, Icon }: NavItemSpec) => {
    const isCurrent = href === "/" ? pathname === "/" : pathname?.startsWith(href);
    return (
      <li key={href} className="m-0 p-0 flex items-center justify-center">
        <Link
          href={href}
          aria-label={label}
          aria-keyshortcuts={shortcut}
          title={`${label} (${shortcut})`}
          aria-current={isCurrent ? "page" : undefined}
          className="w-[30px] h-[30px] m-0 p-0 border-0 outline-none shadow-none flex items-center justify-center bg-white transition-transform duration-150 ease-out hover:scale-110 focus-visible:scale-110 active:scale-95"
        >
          <Icon
            aria-hidden="true"
            strokeWidth={isCurrent ? 2.5 : 1.5}
            className="w-[30px] h-[30px] block text-[#999999]"
          />
          <span className="sr-only">{label}</span>
        </Link>
      </li>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className="flex-1 flex flex-col items-center justify-between w-full m-0 p-0 bg-white"
    >
      <ul className="flex flex-col items-center gap-[5px] m-0 p-0 list-none bg-white">
        {primaryItems.map(renderItem)}
      </ul>
      <ul className="flex flex-col items-center gap-[5px] m-0 p-0 pt-[5px] list-none bg-white">
        {bottomItems.map(renderItem)}
      </ul>
    </nav>
  );
}
