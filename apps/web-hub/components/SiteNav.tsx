"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Calendar,
  Clock,
  KeyRound,
  Layers,
  type LucideIcon,
  Settings,
  SquarePen,
} from "lucide-react";
import {
  UI_SETTINGS_CHANGED_EVENT,
  applyUiSettings,
  readUiSettings,
} from "../lib/ui-settings";

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
    href: "/settings",
    label: "Settings & Plans",
    shortcut: "Alt+6",
    altDigit: "6",
    group: "bottom",
    Icon: Settings,
  },
];

const DRAG_ACTIVATION_PX = 4;
const DRAG_STEP_PX = 28;
const WHEEL_DEBOUNCE_MS = 140;

function clampNavIndex(idx: number): number {
  return Math.max(0, Math.min(NAV_ITEMS.length - 1, idx));
}

export function SiteNav() {
  const pathname = usePathname();
  const router = useRouter();

  const [dragScrollEnabled, setDragScrollEnabled] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  const dragStartYRef = useRef(0);
  const dragStartIndexRef = useRef(0);
  const lastNavIndexRef = useRef(0);
  const pendingDragIndexRef = useRef<number | null>(null);
  const dragNavTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const lastWheelTsRef = useRef(0);
  const announceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentIndex = useMemo(() => {
    const idx = NAV_ITEMS.findIndex((item) =>
      item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href),
    );
    return idx >= 0 ? idx : 0;
  }, [pathname]);

  const announce = useCallback((text: string) => {
    if (announceTimerRef.current) {
      clearTimeout(announceTimerRef.current);
    }
    setLiveAnnouncement(text);
    announceTimerRef.current = setTimeout(() => {
      setLiveAnnouncement("");
    }, 1200);
  }, []);

  const navigateToIndex = useCallback(
    (nextIndex: number) => {
      const clamped = clampNavIndex(nextIndex);
      if (clamped === lastNavIndexRef.current && scrubIndex === clamped) return;
      lastNavIndexRef.current = clamped;
      setScrubIndex(clamped);
      const target = NAV_ITEMS[clamped];
      if (!target) return;
      if (target.href !== pathname) {
        router.push(target.href);
        announce(`Switched to ${target.label}`);
      }
    },
    [announce, pathname, router, scrubIndex],
  );

  useEffect(() => {
    lastNavIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    const syncFromSettings = () => {
      const s = readUiSettings();
      setDragScrollEnabled(s.navDragScroll);
    };
    syncFromSettings();
    for (const item of NAV_ITEMS) {
      router.prefetch(item.href);
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        router.push("/settings");
        return;
      }
      const hit = NAV_ITEMS.find((item) => item.altDigit === event.key);
      if (!hit) return;
      event.preventDefault();
      router.push(hit.href);
    };

    const onStorage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === "color-scheme" ||
        event.key.startsWith("polypost:ui:")
      ) {
        const next = readUiSettings();
        applyUiSettings(next, false);
        setDragScrollEnabled(next.navDragScroll);
      }
    };

    const onLocalSettingsChanged = () => {
      syncFromSettings();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("storage", onStorage);
    window.addEventListener(UI_SETTINGS_CHANGED_EVENT, onLocalSettingsChanged);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(UI_SETTINGS_CHANGED_EVENT, onLocalSettingsChanged);
    };
  }, [router]);

  const handleScrubPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragScrollEnabled) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    dragStartYRef.current = event.clientY;
    dragStartIndexRef.current = currentIndex;
    lastNavIndexRef.current = currentIndex;
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleScrubPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragScrollEnabled) return;
    if (activePointerIdRef.current !== event.pointerId) return;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;

    const deltaY = event.clientY - dragStartYRef.current;
    if (!dragging && Math.abs(deltaY) < DRAG_ACTIVATION_PX) return;

    if (!dragging) {
      setDragging(true);
    }

    const stepOffset = Math.round(deltaY / DRAG_STEP_PX);
    const nextIdx = clampNavIndex(dragStartIndexRef.current + stepOffset);
    if (nextIdx !== pendingDragIndexRef.current) {
      pendingDragIndexRef.current = nextIdx;
      setScrubIndex(nextIdx);
      if (dragNavTimerRef.current) {
        clearTimeout(dragNavTimerRef.current);
      }
      dragNavTimerRef.current = setTimeout(() => {
        if (pendingDragIndexRef.current !== null) {
          navigateToIndex(pendingDragIndexRef.current);
        }
      }, 90);
    }
  };

  const finishScrub = () => {
    if (dragNavTimerRef.current) {
      clearTimeout(dragNavTimerRef.current);
      dragNavTimerRef.current = null;
    }
    const targetIdx = pendingDragIndexRef.current;
    pendingDragIndexRef.current = null;
    activePointerIdRef.current = null;
    setDragging(false);
    setScrubIndex(null);
    if (targetIdx !== null) {
      navigateToIndex(targetIdx);
      setScrubIndex(null);
    }
  };

  const handleScrubWheel = (event: React.WheelEvent<HTMLButtonElement>) => {
    if (!dragScrollEnabled) return;
    if (Math.abs(event.deltaY) < 4) return;
    event.preventDefault();
    const now = Date.now();
    if (now - lastWheelTsRef.current < WHEEL_DEBOUNCE_MS) return;
    lastWheelTsRef.current = now;
    const dir = event.deltaY > 0 ? 1 : -1;
    navigateToIndex(currentIndex + dir);
    setScrubIndex(null);
  };

  const handleScrubKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!dragScrollEnabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      navigateToIndex(currentIndex + 1);
      setScrubIndex(null);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      navigateToIndex(currentIndex - 1);
      setScrubIndex(null);
    } else if (event.key === "Home") {
      event.preventDefault();
      navigateToIndex(0);
      setScrubIndex(null);
    } else if (event.key === "End") {
      event.preventDefault();
      navigateToIndex(NAV_ITEMS.length - 1);
      setScrubIndex(null);
    }
  };

  const primaryItems = NAV_ITEMS.filter((item) => item.group === "primary");
  const bottomItems = NAV_ITEMS.filter((item) => item.group === "bottom");
  const activeVisualIndex = scrubIndex ?? currentIndex;

  const renderItem = ({ href, label, shortcut, Icon }: NavItemSpec) => {
    const itemIndex = NAV_ITEMS.findIndex((item) => item.href === href);
    const isCurrent = href === "/" ? pathname === "/" : pathname?.startsWith(href);
    const isScrubTarget = dragging && scrubIndex === itemIndex;
    return (
      <li key={href} className="m-0 p-0 flex items-center justify-center">
        <Link
          href={href}
          aria-label={label}
          aria-keyshortcuts={shortcut}
          title={`${label} (${shortcut})`}
          aria-current={isCurrent ? "page" : undefined}
          data-scrub-target={isScrubTarget ? "true" : undefined}
          className="w-[30px] h-[30px] m-0 p-0 border-0 outline-none shadow-none flex items-center justify-center bg-white"
        >
          <Icon
            aria-hidden="true"
            strokeWidth={isCurrent || isScrubTarget ? 2.5 : 1.5}
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
      <ul className="flex flex-col items-center gap-[5px] m-0 p-0 list-none bg-white shrink-0">
        {primaryItems.map(renderItem)}
      </ul>

      {dragScrollEnabled ? (
        <button
          type="button"
          data-nav-scrubber="true"
          data-dragging={dragging ? "true" : "false"}
          aria-label="Scroll left menu icons. Drag up or down with mouse or touch, scroll wheel, or press Arrow Up and Arrow Down keys to switch pages."
          title="Drag up/down or scroll to switch between left menu icons"
          onPointerDown={handleScrubPointerDown}
          onPointerMove={handleScrubPointerMove}
          onPointerUp={finishScrub}
          onLostPointerCapture={finishScrub}
          onWheel={handleScrubWheel}
          onKeyDown={handleScrubKeyDown}
          className="group my-[5px] flex flex-col items-center justify-center gap-[5px] bg-white border-0 outline-none shadow-none"
        >
          <span
            aria-hidden="true"
            className={`flex flex-col items-center gap-[4px] transition-opacity duration-150 ${
              dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
            }`}
          >
            {NAV_ITEMS.map((item, idx) => {
              const active = idx === activeVisualIndex;
              return (
                <span
                  key={item.href}
                  style={{
                    width: active ? "5px" : "3px",
                    height: active ? "5px" : "3px",
                    borderRadius: "9999px",
                    backgroundColor: active ? "var(--text-3)" : "var(--border-color)",
                    display: "block",
                  }}
                />
              );
            })}
          </span>
        </button>
      ) : (
        <div className="flex-1 w-full" aria-hidden="true" />
      )}

      <ul className="flex flex-col items-center gap-[5px] m-0 p-0 list-none bg-white shrink-0">
        {bottomItems.map(renderItem)}
      </ul>

      <div className="sr-only" aria-live="polite">
        {liveAnnouncement}
      </div>
    </nav>
  );
}
