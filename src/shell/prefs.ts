import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadAppearance,
  normalizeAppCornerStyle,
  normalizeAppCustomUiColors,
  normalizeAppThemeMode,
  normalizeAppThemePalette,
  type AppearanceState,
  type AppCustomUiColors,
} from "../theme/appTheme";
import { isMac, isTauri, modLabel } from "./platform";

export const PREFS_KEY = "logviewer.prefs";

export type TabLayout = "scroll" | "wrap";
export type TabMaxWidth = "compact" | "standard" | "wide" | "unlimited";
export type EditorFont = "plex" | "system";
export type CloseUnsaved = "ask" | "discard";

export type ShortcutId =
  | "new"
  | "open"
  | "save"
  | "saveAs"
  | "closeTab"
  | "find"
  | "replace"
  | "goto"
  | "parse"
  | "fontUp"
  | "fontDown"
  | "fontReset"
  | "findNext"
  | "findPrev"
  | "insertDate";

export interface ShortcutChord {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

export interface ToolbarVisibility {
  newFile: boolean;
  open: boolean;
  save: boolean;
  parse: boolean;
  find: boolean;
  rules: boolean;
  theme: boolean;
}

export interface AppPrefs {
  uiScale: number;
  tabLayout: TabLayout;
  tabMaxWidth: TabMaxWidth;
  toolbar: ToolbarVisibility;
  alwaysOnTop: boolean;
  editorFont: EditorFont;
  showLineNumbers: boolean;
  showWhitespace: boolean;
  closeUnsaved: CloseUnsaved;
  wrap: boolean;
  shortcuts: Record<ShortcutId, ShortcutChord>;
}

export interface SettingsBundle {
  version: 1;
  appearance: AppearanceState;
  fontSize: number;
  prefs: AppPrefs;
}

export const TOOLBAR_TOGGLES: { key: keyof ToolbarVisibility; label: string }[] = [
  { key: "newFile", label: "新建" },
  { key: "open", label: "打开" },
  { key: "save", label: "保存" },
  { key: "parse", label: "解析" },
  { key: "find", label: "查找" },
  { key: "rules", label: "规则" },
  { key: "theme", label: "主题" },
];

export const SHORTCUT_DEFS: { id: ShortcutId; label: string }[] = [
  { id: "new", label: "新建" },
  { id: "open", label: "打开" },
  { id: "save", label: "保存" },
  { id: "saveAs", label: "另存为" },
  { id: "closeTab", label: "关闭标签" },
  { id: "find", label: "查找" },
  { id: "replace", label: "替换" },
  { id: "goto", label: "转到" },
  { id: "parse", label: "解析分栏" },
  { id: "fontUp", label: "增大字号" },
  { id: "fontDown", label: "减小字号" },
  { id: "fontReset", label: "恢复字号" },
  { id: "findNext", label: "查找下一个" },
  { id: "findPrev", label: "查找上一个" },
  { id: "insertDate", label: "插入时间" },
];

const SHORTCUT_IDS = SHORTCUT_DEFS.map((item) => item.id);

export function shortcutLabel(id: ShortcutId): string {
  return SHORTCUT_DEFS.find((item) => item.id === id)?.label ?? id;
}

function chord(key: string, mod = false, shift = false, alt = false): ShortcutChord {
  return { key, mod, shift, alt };
}

export function defaultShortcuts(): Record<ShortcutId, ShortcutChord> {
  return {
    new: chord("n", true),
    open: chord("o", true),
    save: chord("s", true),
    saveAs: chord("s", true, true),
    closeTab: chord("w", true),
    find: chord("f", true),
    replace: chord("h", true),
    goto: chord("g", true),
    parse: chord("p", true, true),
    fontUp: chord("=", true),
    fontDown: chord("-", true),
    fontReset: chord("0", true),
    findNext: chord("F3"),
    findPrev: chord("F3", false, true),
    insertDate: chord("F5"),
  };
}

function defaultToolbar(): ToolbarVisibility {
  return {
    newFile: true,
    open: true,
    save: true,
    parse: true,
    find: true,
    rules: true,
    theme: true,
  };
}

export function defaultPrefs(): AppPrefs {
  return {
    uiScale: 1,
    tabLayout: "scroll",
    tabMaxWidth: "standard",
    toolbar: defaultToolbar(),
    alwaysOnTop: false,
    editorFont: "plex",
    showLineNumbers: true,
    showWhitespace: false,
    closeUnsaved: "ask",
    wrap: false,
    shortcuts: defaultShortcuts(),
  };
}

export function stepScale(current: number, delta: number): number {
  const next = Math.round((current + delta) * 10) / 10;
  return Math.min(1.5, Math.max(0.8, next));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T, strict: boolean): T | null {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  return strict ? null : fallback;
}

function isChord(value: unknown): value is ShortcutChord {
  if (!value || typeof value !== "object") return false;
  const chordValue = value as ShortcutChord;
  return (
    typeof chordValue.key === "string" &&
    chordValue.key.length > 0 &&
    typeof chordValue.mod === "boolean" &&
    typeof chordValue.shift === "boolean" &&
    typeof chordValue.alt === "boolean"
  );
}

function readShortcuts(value: unknown, strict: boolean): Record<ShortcutId, ShortcutChord> | null {
  const defaults = defaultShortcuts();
  if (!value || typeof value !== "object") return strict ? null : defaults;
  const source = value as Record<string, unknown>;
  const next = { ...defaults };
  for (const id of SHORTCUT_IDS) {
    if (source[id] == null) {
      if (strict) return null;
      continue;
    }
    if (!isChord(source[id])) return strict ? null : next;
    next[id] = {
      key: normalizeKey((source[id] as ShortcutChord).key),
      mod: (source[id] as ShortcutChord).mod,
      shift: (source[id] as ShortcutChord).shift,
      alt: (source[id] as ShortcutChord).alt,
    };
  }
  return next;
}

export function normalizePrefs(value: unknown, strict = false): AppPrefs | null {
  const defaults = defaultPrefs();
  if (!value || typeof value !== "object") return strict ? null : defaults;
  const source = value as Record<string, unknown>;
  const scale = typeof source.uiScale === "number" && source.uiScale >= 0.8 && source.uiScale <= 1.5
    ? stepScale(source.uiScale, 0)
    : strict
      ? null
      : defaults.uiScale;
  if (scale == null) return null;
  const shortcuts = readShortcuts(source.shortcuts, strict);
  if (!shortcuts) return null;
  const toolbarSource = source.toolbar;
  if (strict && (!toolbarSource || typeof toolbarSource !== "object")) return null;
  const toolbar = { ...defaults.toolbar };
  if (toolbarSource && typeof toolbarSource === "object") {
    for (const item of TOOLBAR_TOGGLES) {
      const flag = (toolbarSource as Record<string, unknown>)[item.key];
      if (typeof flag === "boolean") toolbar[item.key] = flag;
      else if (strict) return null;
    }
  }
  const tabLayout = oneOf(source.tabLayout, ["scroll", "wrap"] as const, defaults.tabLayout, strict);
  const tabMaxWidth = oneOf(source.tabMaxWidth, ["compact", "standard", "wide", "unlimited"] as const, defaults.tabMaxWidth, strict);
  const editorFont = oneOf(source.editorFont, ["plex", "system"] as const, defaults.editorFont, strict);
  const closeUnsaved = oneOf(source.closeUnsaved, ["ask", "discard"] as const, defaults.closeUnsaved, strict);
  if (!tabLayout || !tabMaxWidth || !editorFont || !closeUnsaved) return null;
  if (strict && (typeof source.alwaysOnTop !== "boolean" || typeof source.showLineNumbers !== "boolean" || typeof source.showWhitespace !== "boolean" || typeof source.wrap !== "boolean")) {
    return null;
  }
  return {
    uiScale: scale,
    tabLayout,
    tabMaxWidth,
    toolbar,
    alwaysOnTop: typeof source.alwaysOnTop === "boolean" ? source.alwaysOnTop : defaults.alwaysOnTop,
    editorFont,
    showLineNumbers: typeof source.showLineNumbers === "boolean" ? source.showLineNumbers : defaults.showLineNumbers,
    showWhitespace: typeof source.showWhitespace === "boolean" ? source.showWhitespace : defaults.showWhitespace,
    closeUnsaved,
    wrap: typeof source.wrap === "boolean" ? source.wrap : defaults.wrap,
    shortcuts,
  };
}

export function loadPrefs(): AppPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaultPrefs();
    return normalizePrefs(JSON.parse(raw)) ?? defaultPrefs();
  } catch {
    return defaultPrefs();
  }
}

export function persistPrefs(prefs: AppPrefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function normalizeKey(key: string): string {
  if (key === "Add") return "=";
  if (key === "Subtract") return "-";
  if (key === " ") return "Space";
  if (key.length === 1) return key.toLowerCase();
  return key;
}

function sameKey(a: string, b: string): boolean {
  if (a === b) return true;
  const plus = new Set(["=", "+"]);
  const minus = new Set(["-", "_"]);
  return (plus.has(a) && plus.has(b)) || (minus.has(a) && minus.has(b));
}

function ignoresShift(a: string, b: string): boolean {
  return sameKey(a, b) && a !== b;
}

export function chordsEqual(a: ShortcutChord, b: ShortcutChord): boolean {
  const left = normalizeKey(a.key);
  const right = normalizeKey(b.key);
  const shiftOk = a.shift === b.shift || ignoresShift(left, right);
  return a.mod === b.mod && a.alt === b.alt && shiftOk && sameKey(left, right);
}

export function eventMatches(event: KeyboardEvent, chordValue: ShortcutChord): boolean {
  const mod = event.metaKey || event.ctrlKey;
  const pressed = normalizeKey(event.key);
  const wanted = normalizeKey(chordValue.key);
  if (chordValue.mod !== mod || chordValue.alt !== event.altKey || !sameKey(pressed, wanted)) return false;
  if (ignoresShift(pressed, wanted)) return true;
  return chordValue.shift === event.shiftKey;
}

export function matchShortcut(event: KeyboardEvent, shortcuts: Record<ShortcutId, ShortcutChord>): ShortcutId | null {
  const hits = SHORTCUT_IDS.filter((id) => eventMatches(event, shortcuts[id]));
  if (!hits.length) return null;
  hits.sort((a, b) => modifierWeight(shortcuts[b]) - modifierWeight(shortcuts[a]));
  return hits[0];
}

function modifierWeight(chordValue: ShortcutChord): number {
  return Number(chordValue.mod) + Number(chordValue.shift) + Number(chordValue.alt);
}

export function isAcceptableChord(chordValue: ShortcutChord): boolean {
  if (chordValue.mod || chordValue.alt) return true;
  return /^F\d{1,2}$/.test(chordValue.key);
}

export function chordHint(): string {
  const alt = isMac ? "⌥" : "Alt";
  return `请使用带 ${modLabel} 或 ${alt} 的组合，或功能键。`;
}

export function shortcutConflict(
  id: ShortcutId,
  chordValue: ShortcutChord,
  shortcuts: Record<ShortcutId, ShortcutChord>,
): ShortcutId | null {
  for (const other of SHORTCUT_IDS) {
    if (other !== id && chordsEqual(shortcuts[other], chordValue)) return other;
  }
  return null;
}

export function formatShortcut(chordValue: ShortcutChord): string {
  const parts: string[] = [];
  if (chordValue.mod) parts.push(modLabel);
  if (chordValue.alt) parts.push(isMac ? "⌥" : "Alt");
  if (chordValue.shift) parts.push(isMac ? "⇧" : "Shift");
  parts.push(displayKey(chordValue.key));
  return parts.join("+");
}

function displayKey(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

const BUNDLE_ERROR = "这份设置无法识别，请使用本应用导出的文件。";

function colorsMatch(value: unknown, normalized: AppCustomUiColors): boolean {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return (Object.keys(normalized) as (keyof AppCustomUiColors)[]).every((key) => source[key] === normalized[key]);
}

export function exportSettingsBundle(bundle: Omit<SettingsBundle, "version">): string {
  const payload: SettingsBundle = { version: 1, ...bundle };
  return JSON.stringify(payload, null, 2);
}

export function parseSettingsBundle(raw: string): SettingsBundle | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: "这个文件不是有效的设置 JSON。" };
  }
  if (!data || typeof data !== "object") return { error: BUNDLE_ERROR };
  const source = data as Record<string, unknown>;
  if (source.version !== 1 || typeof source.fontSize !== "number" || !Number.isFinite(source.fontSize)) {
    return { error: BUNDLE_ERROR };
  }
  if (!source.appearance || typeof source.appearance !== "object") return { error: BUNDLE_ERROR };
  const appearanceSource = source.appearance as Record<string, unknown>;
  if (
    appearanceSource.mode == null ||
    appearanceSource.palette == null ||
    appearanceSource.corner == null ||
    !appearanceSource.customLight ||
    !appearanceSource.customDark
  ) {
    return { error: BUNDLE_ERROR };
  }
  const mode = typeof appearanceSource.mode === "string" ? appearanceSource.mode : "";
  const palette = typeof appearanceSource.palette === "string" ? appearanceSource.palette : "";
  const corner = typeof appearanceSource.corner === "string" ? appearanceSource.corner : "";
  if (
    normalizeAppThemeMode(mode) !== mode ||
    normalizeAppThemePalette(palette) !== palette ||
    normalizeAppCornerStyle(corner) !== corner
  ) {
    return { error: BUNDLE_ERROR };
  }
  const fallback = loadAppearance();
  const appearance: AppearanceState = {
    mode: normalizeAppThemeMode(mode),
    palette: normalizeAppThemePalette(palette),
    corner: normalizeAppCornerStyle(corner),
    customLight: normalizeAppCustomUiColors(appearanceSource.customLight, fallback.customLight),
    customDark: normalizeAppCustomUiColors(appearanceSource.customDark, fallback.customDark),
  };
  if (!colorsMatch(appearanceSource.customLight, appearance.customLight) || !colorsMatch(appearanceSource.customDark, appearance.customDark)) {
    return { error: BUNDLE_ERROR };
  }
  const prefs = normalizePrefs(source.prefs, true);
  if (!prefs) return { error: BUNDLE_ERROR };
  return { version: 1, appearance, fontSize: source.fontSize, prefs };
}

export function usePrefs() {
  const [prefs, setPrefs] = useState(loadPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  useEffect(() => {
    persistPrefs(prefs);
  }, [prefs]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        if (!cancelled) await getCurrentWindow().setAlwaysOnTop(prefs.alwaysOnTop);
      } catch {
        /* window permission or browser preview */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prefs.alwaysOnTop]);

  const patch = useCallback((partial: Partial<AppPrefs>) => {
    setPrefs((prev) => ({ ...prev, ...partial }));
  }, []);

  const setShortcut = useCallback((id: ShortcutId, chordValue: ShortcutChord): string | null => {
    const current = prefsRef.current;
    if (!isAcceptableChord(chordValue)) return chordHint();
    const conflict = shortcutConflict(id, chordValue, current.shortcuts);
    if (conflict) return `与「${shortcutLabel(conflict)}」冲突`;
    const next = {
      ...current,
      shortcuts: { ...current.shortcuts, [id]: { ...chordValue, key: normalizeKey(chordValue.key) } },
    };
    prefsRef.current = next;
    setPrefs(next);
    return null;
  }, []);

  const resetShortcut = useCallback((id: ShortcutId) => {
    setPrefs((prev) => ({
      ...prev,
      shortcuts: { ...prev.shortcuts, [id]: defaultShortcuts()[id] },
    }));
  }, []);

  const resetShortcuts = useCallback(() => {
    setPrefs((prev) => ({ ...prev, shortcuts: defaultShortcuts() }));
  }, []);

  const replace = useCallback((next: AppPrefs) => {
    const normalized = normalizePrefs(next) ?? defaultPrefs();
    prefsRef.current = normalized;
    setPrefs(normalized);
  }, []);

  return { prefs, patch, setShortcut, resetShortcut, resetShortcuts, replace };
}

export type PrefsApi = ReturnType<typeof usePrefs>;
