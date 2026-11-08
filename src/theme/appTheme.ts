export const THEME_MODE_KEY = "logviewer.theme";
export const THEME_PALETTE_KEY = "logviewer.themePalette";
export const THEME_CUSTOM_KEY = "logviewer.themeCustom";
export const THEME_CUSTOM_DARK_KEY = "logviewer.themeCustomDark";
export const CORNER_STYLE_KEY = "logviewer.cornerStyle";

export type AppThemeMode = "light" | "dark" | "system";
export type AppThemeAppearance = "light" | "dark";
export type AppThemePalette =
  | "pearl"
  | "mist"
  | "graphite"
  | "cobalt"
  | "sage"
  | "amber"
  | "blush"
  | "vscode"
  | "idea"
  | "xcode"
  | "jetbrains"
  | "cursor"
  | "claude"
  | "custom";
export type AppCornerStyle = "none" | "small" | "large";

export interface AppCustomUiColors {
  background: string;
  foreground: string;
  primary: string;
  border: string;
  sidebar: string;
}

export const DEFAULT_APP_CUSTOM_UI_COLORS: AppCustomUiColors = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  primary: "#171717",
  border: "#e5e5e5",
  sidebar: "#fafafa",
};

export const DEFAULT_APP_CUSTOM_UI_COLORS_DARK: AppCustomUiColors = {
  background: "#131416",
  foreground: "#d7d7db",
  primary: "#d0d0d6",
  border: "#6e6e72",
  sidebar: "#19191c",
};

export interface AppCustomUiColorDef {
  key: keyof AppCustomUiColors;
  varName: string;
  rgbVarName?: string;
  label: string;
}

export const APP_CUSTOM_UI_COLOR_DEFS: readonly AppCustomUiColorDef[] = [
  { key: "background", varName: "--background", label: "背景" },
  { key: "foreground", varName: "--foreground", label: "前景" },
  { key: "primary", varName: "--primary", rgbVarName: "--dbx-primary-rgb", label: "主色" },
  { key: "border", varName: "--border", label: "边框" },
  { key: "sidebar", varName: "--sidebar", label: "侧栏" },
];

export const APP_CUSTOM_UI_DERIVED_VAR_NAMES: readonly string[] = [
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--primary-foreground",
  "--sidebar-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-border",
  "--sidebar-ring",
  "--input",
  "--ring",
  "--dbx-chrome",
  "--dbx-chrome-muted",
  "--dbx-content",
  "--dbx-editor-toolbar",
  "--dbx-gutter",
  "--dbx-sidebar-header",
];

export type AppThemePaletteOption = {
  value: AppThemePalette;
  label: string;
  className: string | null;
  previewColor: string;
};

export const APP_THEME_PALETTES: AppThemePaletteOption[] = [
  { value: "pearl", label: "珍珠", className: null, previewColor: "#ffffff" },
  { value: "mist", label: "薄雾", className: "theme-soft", previewColor: "#e4eaf2" },
  { value: "graphite", label: "石墨", className: "theme-graphite", previewColor: "#d8dce4" },
  { value: "cobalt", label: "钴蓝", className: "theme-cobalt", previewColor: "#d8e6f7" },
  { value: "sage", label: "鼠尾草", className: "theme-sage", previewColor: "#dbe9e2" },
  { value: "amber", label: "琥珀", className: "theme-amber", previewColor: "#f4e4b8" },
  { value: "blush", label: "腮红", className: "theme-blush", previewColor: "#f4d9e6" },
  { value: "vscode", label: "VS Code", className: "theme-vscode", previewColor: "#007acc" },
  { value: "idea", label: "IntelliJ", className: "theme-idea", previewColor: "#4b6eaf" },
  { value: "xcode", label: "Xcode", className: "theme-xcode", previewColor: "#0a84ff" },
  { value: "jetbrains", label: "JetBrains", className: "theme-jetbrains", previewColor: "#7b61ff" },
  { value: "cursor", label: "Cursor", className: "theme-cursor", previewColor: "#6ba4ff" },
  { value: "claude", label: "Claude", className: "theme-claude", previewColor: "#c47a50" },
  { value: "custom", label: "自定义", className: null, previewColor: "#171717" },
];

export const APP_THEME_PALETTE_CLASS_NAMES = APP_THEME_PALETTES.map((palette) => palette.className).filter(
  (className): className is string => Boolean(className),
);

const HEX = /^#[0-9a-fA-F]{6}$/;

export function mixHex(a: string, b: string, weight: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255;
  const ag = (pa >> 8) & 255;
  const ab = pa & 255;
  const br = (pb >> 16) & 255;
  const bg = (pb >> 8) & 255;
  const bb = pb & 255;
  const r = Math.round(ar + (br - ar) * weight);
  const g = Math.round(ag + (bg - ag) * weight);
  const bl = Math.round(ab + (bb - ab) * weight);
  return `rgb(${r} ${g} ${bl})`;
}

export function appCustomUiColorValue(hex: string): { color: string; rgbTriplet: string } {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return { color: `rgb(${r} ${g} ${b})`, rgbTriplet: `${r}, ${g}, ${b}` };
}

function rgbChannels(value: string): [number, number, number] {
  const trimmed = value.trim();
  const rgbMatch = /^rgb\((\d+)\s+(\d+)\s+(\d+)\)$/.exec(trimmed);
  if (rgbMatch) return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  const hex = trimmed.replace("#", "");
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

export function hexRelativeLuminance(color: string): number {
  const [r8, g8, b8] = rgbChannels(color);
  const toLinear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r8) + 0.7152 * toLinear(g8) + 0.0722 * toLinear(b8);
}

export function wcagContrastRatio(a: string, b: string): number {
  const lighter = Math.max(hexRelativeLuminance(a), hexRelativeLuminance(b));
  const darker = Math.min(hexRelativeLuminance(a), hexRelativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableTextOn(hex: string): string {
  return wcagContrastRatio(hex, "#ffffff") >= wcagContrastRatio(hex, "#0a0a0a") ? "#ffffff" : "#0a0a0a";
}

function rgbValue(hex: string): string {
  return appCustomUiColorValue(hex).color;
}

export function deriveCustomUiColors(colors: AppCustomUiColors): Record<string, string> {
  const { background, foreground, primary, border, sidebar } = colors;
  const card = mixHex(background, foreground, 0.03);
  const secondary = mixHex(background, foreground, 0.06);
  const accent = mixHex(background, foreground, 0.12);
  const primaryFg = readableTextOn(primary);
  const chrome = mixHex(background, foreground, 0.02);
  const chromeMuted = mixHex(background, foreground, 0.035);
  const toolbar = mixHex(background, foreground, 0.02);
  const gutter = mixHex(background, foreground, 0.035);
  const sidebarHeader = mixHex(sidebar, foreground, 0.02);
  return {
    "--card": card,
    "--card-foreground": rgbValue(foreground),
    "--popover": card,
    "--popover-foreground": rgbValue(foreground),
    "--secondary": secondary,
    "--secondary-foreground": rgbValue(foreground),
    "--muted": secondary,
    "--muted-foreground": mixHex(foreground, background, 0.58),
    "--accent": accent,
    "--accent-foreground": rgbValue(foreground),
    "--primary-foreground": rgbValue(primaryFg),
    "--sidebar-foreground": rgbValue(foreground),
    "--sidebar-accent": mixHex(sidebar, foreground, 0.06),
    "--sidebar-accent-foreground": rgbValue(foreground),
    "--sidebar-primary": rgbValue(primary),
    "--sidebar-primary-foreground": rgbValue(primaryFg),
    "--sidebar-border": rgbValue(border),
    "--sidebar-ring": rgbValue(primary),
    "--input": rgbValue(border),
    "--ring": rgbValue(primary),
    "--dbx-chrome": chrome,
    "--dbx-chrome-muted": chromeMuted,
    "--dbx-content": rgbValue(background),
    "--dbx-editor-toolbar": toolbar,
    "--dbx-gutter": gutter,
    "--dbx-sidebar-header": sidebarHeader,
  };
}

export function normalizeAppThemeMode(value: string | null): AppThemeMode {
  if (value === "dark" || value === "light" || value === "system") return value;
  return "light";
}

export function normalizeAppThemePalette(value: string | null): AppThemePalette {
  if (APP_THEME_PALETTES.some((palette) => palette.value === value)) return value as AppThemePalette;
  return "pearl";
}

export function normalizeAppCornerStyle(value: string | null): AppCornerStyle {
  if (value === "none" || value === "small" || value === "large") return value;
  return "large";
}

export function normalizeAppCustomUiColors(value: unknown, fallback: AppCustomUiColors): AppCustomUiColors {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out = { ...fallback };
  for (const key of Object.keys(fallback) as (keyof AppCustomUiColors)[]) {
    const candidate = source[key];
    out[key] = typeof candidate === "string" && HEX.test(candidate) ? candidate : fallback[key];
  }
  return out;
}

export function getAppThemePaletteClass(palette: AppThemePalette): string | null {
  return APP_THEME_PALETTES.find((option) => option.value === palette)?.className ?? null;
}

export function resolveAppThemeAppearance(mode: AppThemeMode, systemPrefersDark: boolean): AppThemeAppearance {
  if (mode === "system") return systemPrefersDark ? "dark" : "light";
  return mode === "dark" ? "dark" : "light";
}

export function themeModeLabel(mode: AppThemeMode): string {
  if (mode === "light") return "亮色";
  if (mode === "dark") return "暗色";
  return "跟随系统";
}

export function nextThemeMode(mode: AppThemeMode): AppThemeMode {
  const cycle: AppThemeMode[] = ["light", "dark", "system"];
  const index = cycle.indexOf(mode);
  return cycle[(index + 1) % cycle.length] ?? "light";
}

export interface AppearanceState {
  mode: AppThemeMode;
  palette: AppThemePalette;
  corner: AppCornerStyle;
  customLight: AppCustomUiColors;
  customDark: AppCustomUiColors;
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function loadAppearance(): AppearanceState {
  let mode: string | null = null;
  let palette: string | null = null;
  let corner: string | null = null;
  try {
    mode = localStorage.getItem(THEME_MODE_KEY);
    palette = localStorage.getItem(THEME_PALETTE_KEY);
    corner = localStorage.getItem(CORNER_STYLE_KEY);
  } catch {
    /* private mode */
  }
  return {
    mode: normalizeAppThemeMode(mode),
    palette: normalizeAppThemePalette(palette),
    corner: normalizeAppCornerStyle(corner),
    customLight: normalizeAppCustomUiColors(readJson(THEME_CUSTOM_KEY), DEFAULT_APP_CUSTOM_UI_COLORS),
    customDark: normalizeAppCustomUiColors(readJson(THEME_CUSTOM_DARK_KEY), DEFAULT_APP_CUSTOM_UI_COLORS_DARK),
  };
}

export function persistAppearance(state: AppearanceState) {
  try {
    localStorage.setItem(THEME_MODE_KEY, state.mode);
    localStorage.setItem(THEME_PALETTE_KEY, state.palette);
    localStorage.setItem(CORNER_STYLE_KEY, state.corner);
    localStorage.setItem(THEME_CUSTOM_KEY, JSON.stringify(state.customLight));
    localStorage.setItem(THEME_CUSTOM_DARK_KEY, JSON.stringify(state.customDark));
  } catch {
    /* ignore quota */
  }
}

const INLINE_CUSTOM_PROPS = [
  ...APP_CUSTOM_UI_COLOR_DEFS.flatMap((def) => [def.varName, def.rgbVarName].filter(Boolean) as string[]),
  ...APP_CUSTOM_UI_DERIVED_VAR_NAMES,
];

export function applyAppearance(state: AppearanceState, systemPrefersDark: boolean) {
  const root = document.documentElement;
  const appearance = resolveAppThemeAppearance(state.mode, systemPrefersDark);
  root.classList.toggle("dark", appearance === "dark");
  for (const className of APP_THEME_PALETTE_CLASS_NAMES) root.classList.remove(className);
  const paletteClass = state.palette === "custom" ? null : getAppThemePaletteClass(state.palette);
  if (paletteClass) root.classList.add(paletteClass);
  root.dataset.cornerStyle = state.corner;

  if (state.palette === "custom") {
    const colors = appearance === "dark" ? state.customDark : state.customLight;
    for (const def of APP_CUSTOM_UI_COLOR_DEFS) {
      const value = appCustomUiColorValue(colors[def.key]);
      root.style.setProperty(def.varName, value.color);
      if (def.rgbVarName) root.style.setProperty(def.rgbVarName, value.rgbTriplet);
    }
    const derived = deriveCustomUiColors(colors);
    for (const [name, value] of Object.entries(derived)) root.style.setProperty(name, value);
  } else {
    for (const name of INLINE_CUSTOM_PROPS) root.style.removeProperty(name);
  }
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
