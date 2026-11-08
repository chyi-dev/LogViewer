import { useCallback, useEffect, useMemo, useState } from "react";
import { isTauri } from "../shell/platform";
import {
  applyAppearance,
  loadAppearance,
  persistAppearance,
  systemPrefersDark,
  type AppCornerStyle,
  type AppCustomUiColors,
  type AppThemeMode,
  type AppThemePalette,
  type AppearanceState,
} from "./appTheme";

async function syncWindowTheme(mode: AppThemeMode) {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(mode === "system" ? null : mode);
  } catch {
    /* window theme permission or browser preview */
  }
}

export function useAppearance() {
  const [state, setState] = useState<AppearanceState>(loadAppearance);
  const [previewPalette, setPreviewPalette] = useState<AppThemePalette | null>(null);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  const visible = useMemo(
    () => ({ ...state, palette: previewPalette ?? state.palette }),
    [state, previewPalette],
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyAppearance(visible, systemDark);
  }, [visible, systemDark]);

  useEffect(() => {
    persistAppearance(state);
    void syncWindowTheme(state.mode);
  }, [state]);

  const setMode = useCallback((mode: AppThemeMode) => {
    setState((prev) => ({ ...prev, mode }));
  }, []);

  const setPalette = useCallback((palette: AppThemePalette) => {
    setPreviewPalette(null);
    setState((prev) => ({ ...prev, palette }));
  }, []);

  const setCorner = useCallback((corner: AppCornerStyle) => {
    setState((prev) => ({ ...prev, corner }));
  }, []);

  const setCustomColor = useCallback((key: keyof AppCustomUiColors, value: string, dark: boolean) => {
    setState((prev) =>
      dark
        ? { ...prev, customDark: { ...prev.customDark, [key]: value } }
        : { ...prev, customLight: { ...prev.customLight, [key]: value } },
    );
  }, []);

  const replace = useCallback((next: AppearanceState) => {
    setPreviewPalette(null);
    setState(next);
  }, []);

  const resetCustomColors = useCallback((dark: boolean) => {
    setState((prev) =>
      dark
        ? {
            ...prev,
            customDark: {
              background: "#131416",
              foreground: "#d7d7db",
              primary: "#d0d0d6",
              border: "#6e6e72",
              sidebar: "#19191c",
            },
          }
        : {
            ...prev,
            customLight: {
              background: "#ffffff",
              foreground: "#0a0a0a",
              primary: "#171717",
              border: "#e5e5e5",
              sidebar: "#fafafa",
            },
          },
    );
  }, []);

  return {
    state,
    previewPalette,
    setPreviewPalette,
    setMode,
    setPalette,
    setCorner,
    setCustomColor,
    replace,
    resetCustomColors,
    isDark: visible.mode === "dark" || (visible.mode === "system" && systemDark),
  };
}

export type AppearanceApi = ReturnType<typeof useAppearance>;
