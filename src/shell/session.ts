export const SESSION_KEY = "logviewer.session";

export interface ViewportSnap {
  line: number;
  scrollTop: number;
  scrollLeft: number;
}

export interface SessionFile {
  path: string;
  line: number;
  scrollTop?: number;
  scrollLeft?: number;
}

export interface AppSession {
  version: 1;
  files: SessionFile[];
  activePath: string | null;
}

export function emptySession(): AppSession {
  return { version: 1, files: [], activePath: null };
}

function clampLine(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function clampScroll(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export function normalizeViewportSnap(
  value: Partial<ViewportSnap> | number | null | undefined,
): ViewportSnap {
  if (typeof value === "number") {
    return { line: clampLine(value), scrollTop: 0, scrollLeft: 0 };
  }
  if (!value || typeof value !== "object") {
    return { line: 1, scrollTop: 0, scrollLeft: 0 };
  }
  return {
    line: clampLine(value.line),
    scrollTop: clampScroll(value.scrollTop),
    scrollLeft: clampScroll(value.scrollLeft),
  };
}

export function normalizeSession(value: unknown): AppSession {
  const empty = emptySession();
  if (!value || typeof value !== "object") return empty;
  const source = value as Record<string, unknown>;
  const rawFiles = source.files;
  if (!Array.isArray(rawFiles)) return empty;

  const files: SessionFile[] = [];
  const seen = new Set<string>();
  for (const item of rawFiles) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.path !== "string" || !entry.path.trim()) continue;
    const path = entry.path;
    if (seen.has(path)) continue;
    seen.add(path);
    const snap = normalizeViewportSnap({
      line: entry.line as number,
      scrollTop: entry.scrollTop as number | undefined,
      scrollLeft: entry.scrollLeft as number | undefined,
    });
    files.push({
      path,
      line: snap.line,
      scrollTop: snap.scrollTop,
      scrollLeft: snap.scrollLeft,
    });
  }

  let activePath: string | null = null;
  if (typeof source.activePath === "string" && source.activePath) {
    activePath = files.some((f) => f.path === source.activePath)
      ? source.activePath
      : files[0]?.path ?? null;
  } else if (files.length) {
    activePath = files[files.length - 1]?.path ?? null;
  }

  return { version: 1, files, activePath };
}

export function loadSession(): AppSession {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return emptySession();
    return normalizeSession(JSON.parse(raw));
  } catch {
    return emptySession();
  }
}

export function persistSession(session: AppSession) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(normalizeSession(session)));
  } catch {
    /* ignore quota / private mode */
  }
}

export type ViewportSnapMap =
  | Map<string, ViewportSnap | number>
  | Record<string, ViewportSnap | number>;

function snapOf(map: ViewportSnapMap, path: string): ViewportSnap {
  if (map instanceof Map) return normalizeViewportSnap(map.get(path));
  return normalizeViewportSnap(map[path]);
}

export function buildSession(
  tabs: { path: string }[],
  activePath: string | null | undefined,
  viewports: ViewportSnapMap,
): AppSession {
  const files: SessionFile[] = [];
  const seen = new Set<string>();
  for (const tab of tabs) {
    if (!tab.path || seen.has(tab.path)) continue;
    seen.add(tab.path);
    const snap = snapOf(viewports, tab.path);
    files.push({
      path: tab.path,
      line: snap.line,
      scrollTop: snap.scrollTop,
      scrollLeft: snap.scrollLeft,
    });
  }
  const nextActive =
    activePath && files.some((f) => f.path === activePath)
      ? activePath
      : files[0]?.path ?? null;
  return { version: 1, files, activePath: nextActive };
}
