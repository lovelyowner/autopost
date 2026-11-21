/** UI appearance, layout & workspace preferences persisted in browser localStorage. */

export type ThemePreference = "system" | "light" | "dark";
export type GridGapPreference = "0px" | "5px";
export type UiDensityPreference = "compact" | "default" | "comfortable";
export type MotionPreference = "system" | "reduced";
export type GridColumnsPreference = "3" | "2" | "1";
export type OutlineStylePreference = "full" | "columns-only";
export type CornerStylePreference = "sharp" | "rounded";
export type NavIconSizePreference = "24px" | "30px" | "36px";
export type FontScalePreference = "small" | "default" | "large";
export type UiPresetId =
  | "minimal-flush"
  | "column-dividers"
  | "compact-dense"
  | "spaced-cards"
  | "custom";

export interface UiSettings {
  theme: ThemePreference;
  gridGap: GridGapPreference;
  density: UiDensityPreference;
  motion: MotionPreference;
  gridCols: GridColumnsPreference;
  outlineStyle: OutlineStylePreference;
  corners: CornerStylePreference;
  navIconSize: NavIconSizePreference;
  fontScale: FontScalePreference;
}

export const THEME_STORAGE_KEY = "color-scheme";
export const GRID_GAP_STORAGE_KEY = "polypost:ui:grid-gap";
export const DENSITY_STORAGE_KEY = "polypost:ui:density";
export const MOTION_STORAGE_KEY = "polypost:ui:motion";
export const GRID_COLS_STORAGE_KEY = "polypost:ui:grid-cols";
export const OUTLINE_STYLE_STORAGE_KEY = "polypost:ui:outline-style";
export const CORNERS_STORAGE_KEY = "polypost:ui:corners";
export const NAV_ICON_SIZE_STORAGE_KEY = "polypost:ui:nav-icon-size";
export const FONT_SCALE_STORAGE_KEY = "polypost:ui:font-scale";

export const DEFAULT_UI_SETTINGS: UiSettings = {
  theme: "system",
  gridGap: "0px",
  density: "default",
  motion: "system",
  gridCols: "3",
  outlineStyle: "full",
  corners: "sharp",
  navIconSize: "30px",
  fontScale: "default",
};

export interface UiPresetSpec {
  id: Exclude<UiPresetId, "custom">;
  label: string;
  summary: string;
  patch: Omit<UiSettings, "theme" | "motion">;
}

export const UI_PRESETS: UiPresetSpec[] = [
  {
    id: "minimal-flush",
    label: "Minimal Flush",
    summary: "4 cols · 0px gap · 30px icons · sharp",
    patch: {
      gridCols: "3",
      outlineStyle: "full",
      gridGap: "0px",
      density: "default",
      corners: "sharp",
      navIconSize: "30px",
      fontScale: "default",
    },
  },
  {
    id: "column-dividers",
    label: "Column Lines",
    summary: "Only vertical dividers · 16px pad",
    patch: {
      gridCols: "3",
      outlineStyle: "columns-only",
      gridGap: "0px",
      density: "comfortable",
      corners: "sharp",
      navIconSize: "30px",
      fontScale: "default",
    },
  },
  {
    id: "compact-dense",
    label: "Compact Dense",
    summary: "8px pad · 24px icons · small text",
    patch: {
      gridCols: "3",
      outlineStyle: "full",
      gridGap: "0px",
      density: "compact",
      corners: "sharp",
      navIconSize: "24px",
      fontScale: "small",
    },
  },
  {
    id: "spaced-cards",
    label: "Spaced Cards",
    summary: "5px indent · rounded cards · 12px pad",
    patch: {
      gridCols: "3",
      outlineStyle: "full",
      gridGap: "5px",
      density: "default",
      corners: "rounded",
      navIconSize: "30px",
      fontScale: "default",
    },
  },
];

export function detectActiveUiPreset(settings: UiSettings): UiPresetId {
  for (const preset of UI_PRESETS) {
    const p = preset.patch;
    if (
      settings.gridCols === p.gridCols &&
      settings.outlineStyle === p.outlineStyle &&
      settings.gridGap === p.gridGap &&
      settings.density === p.density &&
      settings.corners === p.corners &&
      settings.navIconSize === p.navIconSize &&
      settings.fontScale === p.fontScale
    ) {
      return preset.id;
    }
  }
  return "custom";
}

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage errors when site data is restricted
  }
}

export function readUiSettings(): UiSettings {
  const storedTheme = readStorage(THEME_STORAGE_KEY);
  const theme: ThemePreference =
    storedTheme === "light" || storedTheme === "dark" ? storedTheme : "system";

  const storedGap = readStorage(GRID_GAP_STORAGE_KEY);
  const gridGap: GridGapPreference = storedGap === "5px" ? "5px" : "0px";

  const storedDensity = readStorage(DENSITY_STORAGE_KEY);
  const density: UiDensityPreference =
    storedDensity === "compact" || storedDensity === "comfortable" ? storedDensity : "default";

  const storedMotion = readStorage(MOTION_STORAGE_KEY);
  const motion: MotionPreference = storedMotion === "reduced" ? "reduced" : "system";

  const storedCols = readStorage(GRID_COLS_STORAGE_KEY);
  const gridCols: GridColumnsPreference =
    storedCols === "1" || storedCols === "2" ? storedCols : "3";

  const storedOutlineStyle = readStorage(OUTLINE_STYLE_STORAGE_KEY);
  const outlineStyle: OutlineStylePreference =
    storedOutlineStyle === "columns-only" ? "columns-only" : "full";

  const storedCorners = readStorage(CORNERS_STORAGE_KEY);
  const corners: CornerStylePreference = storedCorners === "rounded" ? "rounded" : "sharp";

  const storedNavSize = readStorage(NAV_ICON_SIZE_STORAGE_KEY);
  const navIconSize: NavIconSizePreference =
    storedNavSize === "24px" || storedNavSize === "36px" ? storedNavSize : "30px";

  const storedFontScale = readStorage(FONT_SCALE_STORAGE_KEY);
  const fontScale: FontScalePreference =
    storedFontScale === "small" || storedFontScale === "large" ? storedFontScale : "default";

  return {
    theme,
    gridGap,
    density,
    motion,
    gridCols,
    outlineStyle,
    corners,
    navIconSize,
    fontScale,
  };
}

export function applyThemePreference(theme: ThemePreference, persist = true): void {
  if (typeof document === "undefined") return;
  if (persist) {
    writeStorage(THEME_STORAGE_KEY, theme === "system" ? null : theme);
  }
  const meta = document.querySelector('meta[name="color-scheme"]');
  const content = theme === "system" ? "light dark" : theme;
  if (meta) {
    meta.setAttribute("content", content);
  }
}

export function applyUiSettings(settings: UiSettings, persist = true): void {
  if (typeof document === "undefined") return;
  applyThemePreference(settings.theme, persist);

  if (persist) {
    writeStorage(GRID_GAP_STORAGE_KEY, settings.gridGap === "0px" ? null : settings.gridGap);
    writeStorage(DENSITY_STORAGE_KEY, settings.density === "default" ? null : settings.density);
    writeStorage(MOTION_STORAGE_KEY, settings.motion === "system" ? null : settings.motion);
    writeStorage(GRID_COLS_STORAGE_KEY, settings.gridCols === "3" ? null : settings.gridCols);
    writeStorage(
      OUTLINE_STYLE_STORAGE_KEY,
      settings.outlineStyle === "full" ? null : settings.outlineStyle,
    );
    writeStorage(CORNERS_STORAGE_KEY, settings.corners === "sharp" ? null : settings.corners);
    writeStorage(
      NAV_ICON_SIZE_STORAGE_KEY,
      settings.navIconSize === "30px" ? null : settings.navIconSize,
    );
    writeStorage(FONT_SCALE_STORAGE_KEY, settings.fontScale === "default" ? null : settings.fontScale);
  }

  const root = document.documentElement;
  const setOrDelete = (attr: keyof DOMStringMap, value: string | null) => {
    if (value === null) {
      delete root.dataset[attr];
    } else {
      root.dataset[attr] = value;
    }
  };

  setOrDelete("gridGap", settings.gridGap === "5px" ? "5px" : null);
  setOrDelete("uiDensity", settings.density === "default" ? null : settings.density);
  setOrDelete("reduceMotion", settings.motion === "reduced" ? "reduced" : null);
  setOrDelete("gridCols", settings.gridCols === "3" ? null : settings.gridCols);
  setOrDelete(
    "outlineStyle",
    settings.outlineStyle === "columns-only" ? "columns-only" : null,
  );
  setOrDelete("uiCorners", settings.corners === "rounded" ? "rounded" : null);
  setOrDelete("navSize", settings.navIconSize === "30px" ? null : settings.navIconSize);
  setOrDelete("fontScale", settings.fontScale === "default" ? null : settings.fontScale);
}

/**
 * Tiny synchronous FOUC-prevention script injected immediately after `<meta name="color-scheme">`
 * in `<head>` so theme and UI layout settings apply before first paint.
 */
export const UI_SETTINGS_INIT_SCRIPT = `(function(){try{var c=localStorage.getItem("color-scheme");var m=document.querySelector('meta[name="color-scheme"]');if(m){m.setAttribute("content",(c==="light"||c==="dark")?c:"light dark");}var r=document.documentElement;var g=localStorage.getItem("polypost:ui:grid-gap");if(g==="5px")r.dataset.gridGap="5px";var d=localStorage.getItem("polypost:ui:density");if(d==="compact"||d==="comfortable")r.dataset.uiDensity=d;var mo=localStorage.getItem("polypost:ui:motion");if(mo==="reduced")r.dataset.reduceMotion="reduced";var gc=localStorage.getItem("polypost:ui:grid-cols");if(gc==="1"||gc==="2")r.dataset.gridCols=gc;var os=localStorage.getItem("polypost:ui:outline-style");if(os==="columns-only")r.dataset.outlineStyle=os;var co=localStorage.getItem("polypost:ui:corners");if(co==="rounded")r.dataset.uiCorners=co;var ns=localStorage.getItem("polypost:ui:nav-icon-size");if(ns==="24px"||ns==="36px")r.dataset.navSize=ns;var fs=localStorage.getItem("polypost:ui:font-scale");if(fs==="small"||fs==="large")r.dataset.fontScale=fs;}catch(e){}})();`;
