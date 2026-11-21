import { describe, expect, it } from "vitest";
import {
  DEFAULT_UI_SETTINGS,
  UI_PRESETS,
  UI_SETTINGS_INIT_SCRIPT,
  detectActiveUiPreset,
} from "../lib/ui-settings";

describe("UI Settings & Change UI Presets", () => {
  it("defaults to Minimal Flush with 30px left menu icons, 3 content columns, and 0px outline gap", () => {
    expect(DEFAULT_UI_SETTINGS).toEqual({
      theme: "system",
      gridGap: "0px",
      density: "default",
      motion: "system",
      gridCols: "3",
      outlineStyle: "full",
      corners: "sharp",
      navIconSize: "30px",
      fontScale: "default",
      navDragScroll: true,
    });
    expect(detectActiveUiPreset(DEFAULT_UI_SETTINGS)).toBe("minimal-flush");
  });

  it("detects each built-in preset regardless of Light/Dark theme and falls back to custom", () => {
    for (const preset of UI_PRESETS) {
      const merged = {
        ...DEFAULT_UI_SETTINGS,
        theme: "dark" as const,
        ...preset.patch,
      };
      expect(detectActiveUiPreset(merged)).toBe(preset.id);
    }

    expect(
      detectActiveUiPreset({
        ...DEFAULT_UI_SETTINGS,
        gridCols: "2",
      }),
    ).toBe("custom");
  });

  it("includes synchronous FOUC-prevention restoration for color-scheme and all UI layout keys", () => {
    expect(UI_SETTINGS_INIT_SCRIPT).toContain("color-scheme");
    expect(UI_SETTINGS_INIT_SCRIPT).toContain("polypost:ui:grid-gap");
    expect(UI_SETTINGS_INIT_SCRIPT).toContain("polypost:ui:grid-cols");
    expect(UI_SETTINGS_INIT_SCRIPT).toContain("polypost:ui:outline-style");
    expect(UI_SETTINGS_INIT_SCRIPT).toContain("polypost:ui:nav-icon-size");
    expect(UI_SETTINGS_INIT_SCRIPT).toContain("polypost:ui:corners");
    expect(UI_SETTINGS_INIT_SCRIPT).toContain("polypost:ui:font-scale");
  });
});
