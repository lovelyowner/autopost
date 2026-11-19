/** UI appearance & workspace preferences persisted in browser localStorage. */

export type ThemePreference = "system" | "light" | "dark";
export type GridGapPreference = "0px" | "5px";
export type UiDensityPreference = "compact" | "default" | "comfortable";
export type MotionPreference = "system" | "reduced";

export interface UiSettings {
  theme: ThemePreference;
  gridGap: GridGapPreference;
  density: UiDensityPreference;
  motion: MotionPreference;
}

export const THEME_STORAGE_KEY = "color-scheme";
export const GRID_GAP_STORAGE_KEY = "polypost:ui:grid-gap";
export const DENSITY_STORAGE_KEY = "polypost:ui:density";
export const MOTION_STORAGE_KEY = "polypost:ui:motion";

export const DEFAULT_UI_SETTINGS: UiSettings = {
  theme: "system",
  gridGap: "0px",
  density: "default",
  motion: "system",
};

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

  return { theme, gridGap, density, motion };
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
  }

  const root = document.documentElement;
  if (settings.gridGap === "5px") {
    root.dataset.gridGap = "5px";
  } else {
    delete root.dataset.gridGap;
  }

  if (settings.density === "default") {
    delete root.dataset.uiDensity;
  } else {
    root.dataset.uiDensity = settings.density;
  }

  if (settings.motion === "reduced") {
    root.dataset.reduceMotion = "reduced";
  } else {
    delete root.dataset.reduceMotion;
  }
}

/**
 * Tiny synchronous FOUC-prevention script injected immediately after `<meta name="color-scheme">`
 * in `<head>` so theme, grid gap, density, and motion apply before first paint.
 */
export const UI_SETTINGS_INIT_SCRIPT = `(function(){try{var c=localStorage.getItem("color-scheme");var m=document.querySelector('meta[name="color-scheme"]');if(m){m.setAttribute("content",(c==="light"||c==="dark")?c:"light dark");}var r=document.documentElement;var g=localStorage.getItem("polypost:ui:grid-gap");if(g==="5px")r.dataset.gridGap="5px";var d=localStorage.getItem("polypost:ui:density");if(d==="compact"||d==="comfortable")r.dataset.uiDensity=d;var mo=localStorage.getItem("polypost:ui:motion");if(mo==="reduced")r.dataset.reduceMotion="reduced";}catch(e){}})();`;
