"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Monitor, Moon, RotateCcw, Sun, X } from "lucide-react";
import {
  DEFAULT_UI_SETTINGS,
  type GridGapPreference,
  type MotionPreference,
  type ThemePreference,
  type UiDensityPreference,
  type UiSettings,
  applyUiSettings,
  readUiSettings,
} from "../lib/ui-settings";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: "Alt+1", label: "Composer & Funnel" },
  { key: "Alt+2", label: "Connect Accounts / Vault" },
  { key: "Alt+3", label: "Templates & Presets" },
  { key: "Alt+4", label: "Calendar & Bulk CSV" },
  { key: "Alt+5", label: "Campaign History" },
  { key: "Alt+6", label: "Plans & Crypto" },
  { key: "Alt+7 / Alt+S", label: "Settings" },
];

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [settings, setSettings] = useState<UiSettings>(DEFAULT_UI_SETTINGS);
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    setSettings(readUiSettings());

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onMqChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onMqChange);

    const onStorage = (e: StorageEvent) => {
      if (
        e.key === null ||
        e.key === "color-scheme" ||
        e.key.startsWith("polypost:ui:")
      ) {
        const next = readUiSettings();
        setSettings(next);
        applyUiSettings(next, false);
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      mq.removeEventListener("change", onMqChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      setSettings(readUiSettings());
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onClose();
    };
    dialog.addEventListener("close", handleClose);

    // Fallback light-dismiss for browsers lacking native <dialog closedby="any">
    let removeFallback: (() => void) | undefined;
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        );
      };
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) {
          dialog.close();
        }
        pressedOutside = false;
      };
      dialog.addEventListener("pointerdown", onPointerDown);
      dialog.addEventListener("pointerup", onPointerUp);
      removeFallback = () => {
        dialog.removeEventListener("pointerdown", onPointerDown);
        dialog.removeEventListener("pointerup", onPointerUp);
      };
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
      removeFallback?.();
    };
  }, [onClose]);

  const updateSettings = (patch: Partial<UiSettings>) => {
    const next: UiSettings = { ...settings, ...patch };
    setSettings(next);
    applyUiSettings(next, true);
  };

  const resetDefaults = () => {
    setSettings(DEFAULT_UI_SETTINGS);
    applyUiSettings(DEFAULT_UI_SETTINGS, true);
  };

  const optionBtnClass = (active: boolean) =>
    `flex-1 px-2.5 py-1.5 border border-[#cccccc] bg-white text-xs text-left flex items-center justify-center gap-1.5 cursor-pointer ${
      active ? "font-bold text-[#333333]" : "text-[#666666] hover:text-[#333333]"
    }`;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="settings-dialog-title"
      {...({ closedby: "any" } as Record<string, string>)}
      className="m-auto w-[min(94vw,540px)] max-h-[90dvh] overflow-y-auto border border-[#cccccc] bg-white text-[#333333] p-0 shadow-none"
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#cccccc] bg-white">
        <div>
          <h2 id="settings-dialog-title" className="text-sm font-bold text-[#333333]">
            Interface &amp; Theme Settings
          </h2>
          <p className="text-[11px] text-[#999999]">
            Saved locally in your browser. Instant across all routes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label="Close settings"
          className="border border-[#cccccc] bg-white p-1.5 text-[#666666] hover:text-[#333333] cursor-pointer"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <div className="divide-y divide-[#cccccc] text-xs">
        {/* Theme Selector (System / Light / Dark) */}
        <section className="p-3 space-y-2 bg-white">
          <div className="flex items-center justify-between">
            <span className="font-bold uppercase tracking-wider text-[10px] text-[#333333]">
              Color Theme
            </span>
            <span className="font-mono text-[10px] text-[#999999]">
              Active:{" "}
              {settings.theme === "system"
                ? `System (${systemDark ? "Dark" : "Light"})`
                : settings.theme === "dark"
                  ? "Dark (#111111)"
                  : "Light (#ffffff)"}
            </span>
          </div>
          <div className="flex flex-wrap gap-0">
            {(
              [
                {
                  id: "system" as ThemePreference,
                  label: `System (${systemDark ? "Dark" : "Light"})`,
                  Icon: Monitor,
                },
                { id: "light" as ThemePreference, label: "Light", Icon: Sun },
                { id: "dark" as ThemePreference, label: "Dark", Icon: Moon },
              ] as const
            ).map(({ id, label, Icon }, idx) => (
              <button
                key={id}
                type="button"
                autoFocus={idx === 0}
                aria-pressed={settings.theme === id}
                onClick={() => updateSettings({ theme: id })}
                className={`${optionBtnClass(settings.theme === id)} ${idx > 0 ? "-ml-[1px]" : ""}`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Grid Outline Spacing */}
        <section className="p-3 space-y-2 bg-white">
          <div className="flex items-center justify-between">
            <span className="font-bold uppercase tracking-wider text-[10px] text-[#333333]">
              Outline Grid Spacing
            </span>
            <span className="font-mono text-[10px] text-[#999999]">
              4 cols (40px menu + 3 content)
            </span>
          </div>
          <div className="flex gap-0">
            {(
              [
                { id: "0px" as GridGapPreference, label: "Flush Outlines (0px)" },
                { id: "5px" as GridGapPreference, label: "Indented Rows (5px)" },
              ] as const
            ).map(({ id, label }, idx) => (
              <button
                key={id}
                type="button"
                aria-pressed={settings.gridGap === id}
                onClick={() => updateSettings({ gridGap: id })}
                className={`${optionBtnClass(settings.gridGap === id)} ${idx > 0 ? "-ml-[1px]" : ""}`}
              >
                <span>{label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Cell Padding / Density */}
        <section className="p-3 space-y-2 bg-white">
          <span className="font-bold uppercase tracking-wider text-[10px] text-[#333333] block">
            Cell Density &amp; Padding
          </span>
          <div className="flex gap-0">
            {(
              [
                { id: "compact" as UiDensityPreference, label: "Compact (8px)" },
                { id: "default" as UiDensityPreference, label: "Default (12px)" },
                { id: "comfortable" as UiDensityPreference, label: "Comfortable (16px)" },
              ] as const
            ).map(({ id, label }, idx) => (
              <button
                key={id}
                type="button"
                aria-pressed={settings.density === id}
                onClick={() => updateSettings({ density: id })}
                className={`${optionBtnClass(settings.density === id)} ${idx > 0 ? "-ml-[1px]" : ""}`}
              >
                <span>{label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Motion Preference */}
        <section className="p-3 space-y-2 bg-white">
          <span className="font-bold uppercase tracking-wider text-[10px] text-[#333333] block">
            Motion &amp; Transitions
          </span>
          <div className="flex gap-0">
            {(
              [
                { id: "system" as MotionPreference, label: "Follow System" },
                { id: "reduced" as MotionPreference, label: "Reduced Motion" },
              ] as const
            ).map(({ id, label }, idx) => (
              <button
                key={id}
                type="button"
                aria-pressed={settings.motion === id}
                onClick={() => updateSettings({ motion: id })}
                className={`${optionBtnClass(settings.motion === id)} ${idx > 0 ? "-ml-[1px]" : ""}`}
              >
                <span>{label}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Left Menu Dimensions & Keyboard Shortcuts */}
        <section className="p-3 space-y-2 bg-white">
          <div className="flex items-center justify-between">
            <span className="font-bold uppercase tracking-wider text-[10px] text-[#333333]">
              Left Menu &amp; Keyboard Shortcuts
            </span>
            <span className="font-mono text-[10px] text-[#999999]">
              30px icons · 40px rail · 5px pad
            </span>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-[#666666] m-0 p-0 list-none">
            {SHORTCUTS.map((s) => (
              <li key={s.key} className="flex items-center justify-between pr-2">
                <span>{s.label}</span>
                <kbd className="font-mono text-[#333333] border border-[#cccccc] px-1.5 py-0.5 text-[10px]">
                  {s.key}
                </kbd>
              </li>
            ))}
          </ul>
        </section>

        {/* Quick Workspace Actions & Reset */}
        <section className="p-3 flex flex-wrap items-center justify-between gap-2 bg-white">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <Link
              href="/vault"
              onClick={() => dialogRef.current?.close()}
              className="text-[#666666] hover:text-[#333333] hover:font-bold"
            >
              Account Vault →
            </Link>
            <Link
              href="/plans"
              onClick={() => dialogRef.current?.close()}
              className="text-[#666666] hover:text-[#333333] hover:font-bold"
            >
              Plans &amp; Treasury →
            </Link>
          </div>
          <div className="flex items-center gap-0">
            <button
              type="button"
              onClick={resetDefaults}
              className="border border-[#cccccc] bg-white px-2.5 py-1 text-[11px] text-[#666666] hover:text-[#333333] flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
              <span>Reset Defaults</span>
            </button>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="-ml-[1px] border border-[#cccccc] bg-white px-3 py-1 text-[11px] font-bold text-[#333333] cursor-pointer"
            >
              Done
            </button>
          </div>
        </section>
      </div>
    </dialog>
  );
}
