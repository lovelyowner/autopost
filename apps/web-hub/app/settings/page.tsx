"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { PlansBillingSection } from "@/components/PlansBillingSection";
import {
  type CornerStylePreference,
  DEFAULT_UI_SETTINGS,
  type FontScalePreference,
  type GridColumnsPreference,
  type GridGapPreference,
  type MotionPreference,
  type NavIconSizePreference,
  type OutlineStylePreference,
  type ThemePreference,
  UI_PRESETS,
  type UiDensityPreference,
  type UiPresetSpec,
  type UiSettings,
  applyUiSettings,
  detectActiveUiPreset,
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

  const applyPreset = (preset: UiPresetSpec) => {
    updateSettings(preset.patch, `Applied UI preset: ${preset.label}.`);
  };

  const resetDefaults = () => {
    setSettings(DEFAULT_UI_SETTINGS);
    applyUiSettings(DEFAULT_UI_SETTINGS, true);
    setStatusMessage(
      "Reset UI preferences to defaults (System theme, Minimal Flush, 30px menu icons, 0px outline spacing).",
    );
  };

  const activePresetId = detectActiveUiPreset(settings);
  const activePresetLabel =
    UI_PRESETS.find((p) => p.id === activePresetId)?.label ?? "Custom";

  // Buttons filling their field have NO outer box outlines — ONLY 1px vertical outlines between columns (.ui-btn-cols)
  const colRadioLabelClass = (active: boolean) =>
    `flex-1 min-h-[34px] px-2 py-1.5 border-0 rounded-none bg-white text-xs flex items-center justify-center gap-1.5 cursor-pointer select-none peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-[#cccccc] peer-focus-visible:outline-offset-0 ${
      active ? "font-bold text-[#333333]" : "text-[#666666] hover:text-[#333333]"
    }`;

  return (
    <div className="ui-grid-3">
      {/* Row 1: Settings Header (2 cols) + Active Interface State (1 col) */}
      <section className="md:col-span-2 bg-white flex flex-col justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-[#333333]">
            Settings, Change UI &amp; Billing Plans
          </h1>
          <p className="text-xs text-[#666666]">
            Switch full UI presets, theme, column layout, left menu icon size, outlines, density, and typography — saved locally and synced across tabs. Plans &amp; Crypto billing live at the bottom of this page.
          </p>
          {statusMessage && (
            <p role="status" className="text-[11px] font-mono text-[#333333] pt-0.5">
              {statusMessage}
            </p>
          )}
        </div>
        <div className="ui-btn-cols border-t border-[#cccccc]">
          <a
            href="#plans"
            className="flex-1 py-2 px-3 bg-white text-xs text-center text-[#666666] hover:text-[#333333] hover:font-bold whitespace-nowrap"
          >
            Jump to Plans &amp; Payments ↓
          </a>
          <button
            type="button"
            onClick={resetDefaults}
            className="flex-1 py-2 px-3 bg-white text-xs text-[#666666] hover:text-[#333333] flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Reset UI Defaults</span>
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
              <span>UI Preset:</span>
              <strong className="font-mono text-[#333333]">{activePresetLabel}</strong>
            </div>
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
              <span>Layout:</span>
              <strong className="font-mono text-[#333333]">
                {Number(settings.gridCols) + 1} cols · {settings.gridGap} gap
              </strong>
            </div>
            <div className="flex items-center justify-between">
              <span>Left Menu:</span>
              <strong className="font-mono text-[#333333]">
                {settings.navIconSize} icons · {parseInt(settings.navIconSize, 10) + 10}px rail
              </strong>
            </div>
          </div>
        </div>
      </section>

      {/* Row 2: Change UI Presets Strip (3 cols) */}
      <section className="md:col-span-3 bg-white space-y-2.5 text-xs">
        <fieldset className="border-0 p-0 m-0 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <legend className="text-xs font-bold uppercase tracking-wider text-[#333333] p-0">
              Change UI — Style Presets
            </legend>
            <span className="text-[11px] text-[#999999]">
              One-click workspace layouts (preserves your selected Light/Dark theme)
            </span>
          </div>
          <div className="ui-btn-cols ui-btn-cols-stack-sm">
            {UI_PRESETS.map((preset) => {
              const inputId = `settings-preset-${preset.id}`;
              const active = activePresetId === preset.id;
              return (
                <div key={preset.id} className="flex flex-1 min-w-0">
                  <input
                    id={inputId}
                    type="radio"
                    name="ui-preset"
                    value={preset.id}
                    checked={active}
                    onChange={() => applyPreset(preset)}
                    className="sr-only peer"
                  />
                  <label
                    htmlFor={inputId}
                    className={`flex-1 px-3 py-2 border-0 rounded-none bg-white text-left cursor-pointer select-none peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-[#cccccc] peer-focus-visible:outline-offset-0 ${
                      active ? "text-[#333333]" : "text-[#666666] hover:text-[#333333]"
                    }`}
                  >
                    <div className={`text-xs ${active ? "font-bold text-[#333333]" : "font-medium text-[#333333]"}`}>
                      {preset.label}
                    </div>
                    <div className="text-[10px] font-mono text-[#999999] mt-0.5">
                      {preset.summary}
                    </div>
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>
      </section>

      {/* Row 3: Theme & Typography (1 col) + Columns & Outlines (1 col) + Menu, Density & Shortcuts (1 col) */}
      <section className="md:col-span-1 bg-white space-y-4 text-xs">
        <fieldset className="border-0 p-0 m-0 space-y-2">
          <legend className="text-xs font-bold uppercase tracking-wider text-[#333333] p-0">
            Color Theme
          </legend>
          <div className="ui-btn-cols">
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
            ).map(({ id, label, Icon }) => {
              const inputId = `settings-theme-${id}`;
              return (
                <div key={id} className="flex flex-1 min-w-0">
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
                  <label htmlFor={inputId} className={colRadioLabelClass(settings.theme === id)}>
                    <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{label}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="border-0 p-0 m-0 space-y-2">
          <legend className="text-xs font-bold uppercase tracking-wider text-[#333333] p-0">
            Text Scale
          </legend>
          <div className="ui-btn-cols">
            {(
              [
                { id: "small" as FontScalePreference, label: "Small" },
                { id: "default" as FontScalePreference, label: "Default" },
                { id: "large" as FontScalePreference, label: "Large" },
              ] as const
            ).map(({ id, label }) => {
              const inputId = `settings-font-${id}`;
              return (
                <div key={id} className="flex flex-1 min-w-0">
                  <input
                    id={inputId}
                    type="radio"
                    name="ui-font-scale"
                    value={id}
                    checked={settings.fontScale === id}
                    onChange={() =>
                      updateSettings({ fontScale: id }, `Text scale set to ${label}.`)
                    }
                    className="sr-only peer"
                  />
                  <label htmlFor={inputId} className={colRadioLabelClass(settings.fontScale === id)}>
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
          <div className="ui-btn-cols">
            {(
              [
                { id: "system" as MotionPreference, label: "Follow System" },
                { id: "reduced" as MotionPreference, label: "Reduced" },
              ] as const
            ).map(({ id, label }) => {
              const inputId = `settings-motion-${id}`;
              return (
                <div key={id} className="flex flex-1 min-w-0">
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
                  <label htmlFor={inputId} className={colRadioLabelClass(settings.motion === id)}>
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
            Content Columns
          </legend>
          <div className="ui-btn-cols">
            {(
              [
                { id: "3" as GridColumnsPreference, label: "3 Cols (4 total)" },
                { id: "2" as GridColumnsPreference, label: "2 Cols" },
                { id: "1" as GridColumnsPreference, label: "1 Col" },
              ] as const
            ).map(({ id, label }) => {
              const inputId = `settings-cols-${id}`;
              return (
                <div key={id} className="flex flex-1 min-w-0">
                  <input
                    id={inputId}
                    type="radio"
                    name="ui-grid-cols"
                    value={id}
                    checked={settings.gridCols === id}
                    onChange={() =>
                      updateSettings({ gridCols: id }, `Content columns set to ${label}.`)
                    }
                    className="sr-only peer"
                  />
                  <label htmlFor={inputId} className={colRadioLabelClass(settings.gridCols === id)}>
                    <span>{label}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="border-0 p-0 m-0 space-y-2">
          <legend className="text-xs font-bold uppercase tracking-wider text-[#333333] p-0">
            Outline Style
          </legend>
          <div className="ui-btn-cols">
            {(
              [
                { id: "full" as OutlineStylePreference, label: "Full Grid Outlines" },
                { id: "columns-only" as OutlineStylePreference, label: "Column Lines Only" },
              ] as const
            ).map(({ id, label }) => {
              const inputId = `settings-outline-style-${id}`;
              return (
                <div key={id} className="flex flex-1 min-w-0">
                  <input
                    id={inputId}
                    type="radio"
                    name="ui-outline-style"
                    value={id}
                    checked={settings.outlineStyle === id}
                    onChange={() =>
                      updateSettings({ outlineStyle: id }, `Outline style set to ${label}.`)
                    }
                    className="sr-only peer"
                  />
                  <label htmlFor={inputId} className={colRadioLabelClass(settings.outlineStyle === id)}>
                    <span>{label}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="border-0 p-0 m-0 space-y-2">
          <legend className="text-xs font-bold uppercase tracking-wider text-[#333333] p-0">
            Outline Spacing &amp; Corners
          </legend>
          <div className="ui-btn-cols">
            {(
              [
                { id: "0px" as GridGapPreference, label: "Flush (0px)" },
                { id: "5px" as GridGapPreference, label: "Spaced (5px)" },
              ] as const
            ).map(({ id, label }) => {
              const inputId = `settings-gap-${id}`;
              return (
                <div key={id} className="flex flex-1 min-w-0">
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
                  <label htmlFor={inputId} className={colRadioLabelClass(settings.gridGap === id)}>
                    <span>{label}</span>
                  </label>
                </div>
              );
            })}
          </div>
          <div className="ui-btn-cols border-t border-[#cccccc]">
            {(
              [
                { id: "sharp" as CornerStylePreference, label: "Sharp (0px)" },
                { id: "rounded" as CornerStylePreference, label: "Rounded (6px)" },
              ] as const
            ).map(({ id, label }) => {
              const inputId = `settings-corners-${id}`;
              return (
                <div key={id} className="flex flex-1 min-w-0">
                  <input
                    id={inputId}
                    type="radio"
                    name="ui-corners"
                    value={id}
                    checked={settings.corners === id}
                    onChange={() =>
                      updateSettings({ corners: id }, `Corners set to ${label}.`)
                    }
                    className="sr-only peer"
                  />
                  <label htmlFor={inputId} className={colRadioLabelClass(settings.corners === id)}>
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
            Left Menu Icon Size
          </legend>
          <div className="ui-btn-cols">
            {(
              [
                { id: "24px" as NavIconSizePreference, label: "24px" },
                { id: "30px" as NavIconSizePreference, label: "30px" },
                { id: "36px" as NavIconSizePreference, label: "36px" },
              ] as const
            ).map(({ id, label }) => {
              const inputId = `settings-nav-size-${id}`;
              return (
                <div key={id} className="flex flex-1 min-w-0">
                  <input
                    id={inputId}
                    type="radio"
                    name="ui-nav-size"
                    value={id}
                    checked={settings.navIconSize === id}
                    onChange={() =>
                      updateSettings({ navIconSize: id }, `Left menu icons set to ${label}.`)
                    }
                    className="sr-only peer"
                  />
                  <label htmlFor={inputId} className={colRadioLabelClass(settings.navIconSize === id)}>
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
          <div className="ui-btn-cols">
            {(
              [
                { id: "compact" as UiDensityPreference, label: "Compact" },
                { id: "default" as UiDensityPreference, label: "Default" },
                { id: "comfortable" as UiDensityPreference, label: "Roomy" },
              ] as const
            ).map(({ id, label }) => {
              const inputId = `settings-density-${id}`;
              return (
                <div key={id} className="flex flex-1 min-w-0">
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
                  <label htmlFor={inputId} className={colRadioLabelClass(settings.density === id)}>
                    <span>{label}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#333333]">
            Keyboard Shortcuts
          </h2>
          <ul className="space-y-1 text-[11px] text-[#666666] m-0 p-0 list-none">
            {SHORTCUTS.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-2">
                <Link
                  href={s.href}
                  className="text-[#666666] hover:text-[#333333] hover:font-bold"
                >
                  {s.label}
                </Link>
                <kbd className="font-mono text-[#333333] px-1 text-[10px]">
                  {s.key}
                </kbd>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Bottom Section: Transferred Plans, Crypto Checkout & Self-Custody Billing */}
      <PlansBillingSection />
    </div>
  );
}
