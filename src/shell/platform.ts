export const isMac = /mac/i.test(navigator.platform) || /mac/i.test(navigator.userAgent);

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const modLabel = isMac ? "⌘" : "Ctrl";
