"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { PlansBillingSection } from "@/components/PlansBillingSection";
import {
  DEFAULT_UI_SETTINGS,
  type GridGapPreference,
  type MotionPreference,
  type ThemePreference,
  type UiDensityPreference,
  type UiSettings,
  applyUiSettings,
  readUiSettings,
} from "@/lib/ui-settings";

const SHORTCUTS = [
  { key: "Alt+1", label: "Composer & Funnel", href: "/" },
  { key: "Alt+2", label: "Connect Accounts / Vault", href: "/vault" },
  { key: "Alt+3", label: "Templates & Presets", href: "/presets" },
  { key: "Alt+4", label: "Calendar & Bulk CSV", href: "/calendar" },
  { key: "Alt+5", label: "Campaign History", href: "/history" },
  { key: "Alt+6 / Alt+S", label: "Settings & Plans", href: "/settings" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<UiSettings>(DEFAULT_UI_SETTINGS);
  const [systemDark, setSystemDark] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

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

  const updateSettings = (patch: Partial<UiSettings>, announcement?: string) => {
    const next: UiSettings = { ...settings, ...patch };
    setSettings(next);
    applyUiSettings(next, true);
    if (announcement) {
      setStatusMessage(announcement);
    }
  };

  const resetDefaults = () => {
    setSettings(DEFAULT_UI_SETTINGS);
    applyUiSettings(DEFAULT_UI_SETTINGS, true);
    setStatusMessage("Reset UI preferences to defaults (System theme, Flush 0px outlines, Default 12px density).");
  };

  const radioLabelClass = (active: boolean) =>
    `flex-1 min-h-[34px] px-2.5 py-1.5 border border-[#cccccc] bg-white text-xs flex items-center justify-center gap-1.5 cursor-pointer select-none peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-[#cccccc] peer-focus-visible:outline-offset-0 ${
      active ? "font-bold text-[#333333]" : "text-[#666666] hover:text-[#333333]"
    }`;

  return (
    <div className="ui-grid-3">
      {/* Row 1: Settings Header (2 cols) + Active UI Telemetry (1 col) */}
      <section className="md:col-span-2 bg-white flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-[#333333]">
            Settings, Theme &amp; Billing Plans
          </h1>
          <p className="text-xs text-[#666666]">
            Customize color theme, outline grid spacing, cell density, and motion preferences — saved locally in your browser and synced across tabs. Plans &amp; Crypto payments are located below.
          </p>
          {statusMessage && (
            <p role="status" className="text-[11px] font-mono text-[#333333] pt-0.5">
              {statusMessage}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-0 shrink-0">
          <a
            href="#plans"
            className="border border-[#cccccc] bg-white px-3 py-1.5 text-xs text-[#666666] hover:text-[#333333] hover:font-bold whitespace-nowrap"
          >
            Plans &amp; Payments ↓
          </a>
          <button
            type="button"
            onClick={resetDefaults}
            className="-ml-[1px] border border-[#cccccc] bg-white px-3 py-1.5 text-xs text-[#666666] hover:text-[#333333] flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Reset Defaults</span>
          </button>
        </div>
      </section>

      <section className="md:col-span-1 bg-white text-xs space-y-1 flex flex-col justify-between">
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#999999]">
            Active Interface State
          </h2>
          <div className="mt-1.5 space-y-1 text-[#666666]">
            <div className="flex items-center justify-between">
              <span>Theme:</span>
              <strong className="font-mono text-[#333333]">
                {settings.theme === "system"
                  ? `System (${systemDark ? "Dark" : "Light"})`
                  : settings.theme === "dark"
                    ? "Dark (#111111)"
                    : "Light (#ffffff)"}
              </strong>
            </div>
            <div className="flex items-center justify-between">
              <span>Outline Spacing:</span>
              <strong className="font-mono text-[#333333]">
                {settings.gridGap === "0px" ? "Flush (0px)" : "Indented (5px)"}
              </strong>
            </div>
            <div className="flex items-center justify-between">
              <span>Cell Density:</span>
              <strong className="font-mono text-[#333333] capitalize">
                {settings.density}
              </strong>
            </div>
            <div className="flex items-center justify-between">
              <span>Left Menu:</span>
              <strong className="font-mono text-[#333333]">30px · 40px rail</strong>
            </div>
          </div>
        </div>
      </section>

      {/* Row 2: Theme & Motion (1 col) + Layout & Density (1 col) + Keyboard Shortcuts (1 col) */}
      <section className="md:col-span-1 bg-white space-y-4 text-xs">
        <fieldset className="border-0 p-0 m-0 space-y-2">
          <legend className="text-xs font-bold uppercase tracking-wider text-[#333333] p-0">
            Color Theme
          </legend>
          <p className="text-[11px] text-[#666666]">
            Follows your OS color scheme by default, or pin Light / Dark explicitly.
          </p>
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
            ).map(({ id, label, Icon }, idx) => {
              const inputId = `settings-theme-${id}`;
              return (
                <div key={id} className={`flex flex-1 min-w-[90px] ${idx > 0 ? "-ml-[1px]" : ""}`}>
                  <input
                    id={inputId}
                    type="radio"
                    name="ui-theme"
                    value={id}
                    checked={settings.theme === id}
                    onChange={() =>
                      updateSettings({ theme: id }, `Theme updated to ${label}.`)
                    }
                    className="sr-only peer"
                  />
                  <label htmlFor={inputId} className={radioLabelClass(settings.theme === id)}>
                    <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{label}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="border-0 p-0 m-0 space-y-2">
          <legend className="text-xs font-bold uppercase tracking-wider text-[#333333] p-0">
            Motion &amp; Transitions
          </legend>
          <div className="flex gap-0">
            {(
              [
                { id: "system" as MotionPreference, label: "Follow System" },
                { id: "reduced" as MotionPreference, label: "Reduced Motion" },
              ] as const
            ).map(({ id, label }, idx) => {
              const inputId = `settings-motion-${id}`;
              return (
                <div key={id} className={`flex flex-1 ${idx > 0 ? "-ml-[1px]" : ""}`}>
                  <input
                    id={inputId}
                    type="radio"
                    name="ui-motion"
                    value={id}
                    checked={settings.motion === id}
                    onChange={() =>
                      updateSettings({ motion: id }, `Motion set to ${label}.`)
                    }
                    className="sr-only peer"
                  />
                  <label htmlFor={inputId} className={radioLabelClass(settings.motion === id)}>
                    <span>{label}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>
      </section>

      <section className="md:col-span-1 bg-white space-y-4 text-xs">
        <fieldset className="border-0 p-0 m-0 space-y-2">
          <legend className="text-xs font-bold uppercase tracking-wider text-[#333333] p-0">
            Outline Grid Spacing
          </legend>
          <p className="text-[11px] text-[#666666]">
            Controls spacing between 1px outlines across the 3 content columns.
          </p>
          <div className="flex gap-0">
            {(
              [
                { id: "0px" as GridGapPreference, label: "Flush Outlines (0px)" },
                { id: "5px" as GridGapPreference, label: "Indented Rows (5px)" },
              ] as const
            ).map(({ id, label }, idx) => {
              const inputId = `settings-gap-${id}`;
              return (
                <div key={id} className={`flex flex-1 ${idx > 0 ? "-ml-[1px]" : ""}`}>
                  <input
                    id={inputId}
                    type="radio"
                    name="ui-grid-gap"
                    value={id}
                    checked={settings.gridGap === id}
                    onChange={() =>
                      updateSettings({ gridGap: id }, `Outline spacing set to ${label}.`)
                    }
                    className="sr-only peer"
                  />
                  <label htmlFor={inputId} className={radioLabelClass(settings.gridGap === id)}>
                    <span>{label}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="border-0 p-0 m-0 space-y-2">
          <legend className="text-xs font-bold uppercase tracking-wider text-[#333333] p-0">
            Cell Density &amp; Padding
          </legend>
          <div className="flex gap-0">
            {(
              [
                { id: "compact" as UiDensityPreference, label: "Compact (8px)" },
                { id: "default" as UiDensityPreference, label: "Default (12px)" },
                { id: "comfortable" as UiDensityPreference, label: "Comfortable (16px)" },
              ] as const
            ).map(({ id, label }, idx) => {
              const inputId = `settings-density-${id}`;
              return (
                <div key={id} className={`flex flex-1 ${idx > 0 ? "-ml-[1px]" : ""}`}>
                  <input
                    id={inputId}
                    type="radio"
                    name="ui-density"
                    value={id}
                    checked={settings.density === id}
                    onChange={() =>
                      updateSettings({ density: id }, `Cell density set to ${label}.`)
                    }
                    className="sr-only peer"
                  />
                  <label htmlFor={inputId} className={radioLabelClass(settings.density === id)}>
                    <span>{label}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>
      </section>

      <section className="md:col-span-1 bg-white space-y-2.5 text-xs">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[#333333]">
          Navigation &amp; Keyboard Shortcuts
        </h2>
        <ul className="space-y-1.5 text-[11px] text-[#666666] m-0 p-0 list-none">
          {SHORTCUTS.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-2">
              <Link
                href={s.href}
                className="text-[#666666] hover:text-[#333333] hover:font-bold"
              >
                {s.label}
              </Link>
              <kbd className="font-mono text-[#333333] border border-[#cccccc] px-1.5 py-0.5 text-[10px]">
                {s.key}
              </kbd>
            </li>
          ))}
        </ul>
      </section>

      {/* Bottom Section: Transferred Plans, Crypto Checkout & Self-Custody Billing */}
      <PlansBillingSection />
    </div>
  );
}
