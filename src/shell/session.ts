export const SESSION_KEY = "logviewer.session";

export interface SessionFile {
  path: string;
  line: number;
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
    files.push({ path, line: clampLine(entry.line) });
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

export function buildSession(
  tabs: { path: string }[],
  activePath: string | null | undefined,
  lines: Map<string, number> | Record<string, number>,
): AppSession {
  const lineOf = (path: string): number => {
    if (lines instanceof Map) return clampLine(lines.get(path) ?? 1);
    return clampLine(lines[path] ?? 1);
  };
  const files: SessionFile[] = [];
  const seen = new Set<string>();
  for (const tab of tabs) {
    if (!tab.path || seen.has(tab.path)) continue;
    seen.add(tab.path);
    files.push({ path: tab.path, line: lineOf(tab.path) });
  }
  const nextActive =
    activePath && files.some((f) => f.path === activePath)
      ? activePath
      : files[0]?.path ?? null;
  return { version: 1, files, activePath: nextActive };
}
