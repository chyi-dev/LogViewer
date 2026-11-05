export interface FindOptions {
  needle: string;
  matchCase: boolean;
  regex: boolean;
}

export interface MatchHit {
  index: number;
  length: number;
  line: number;
  preview: string;
}

export type MatcherResult =
  | { ok: true; re: RegExp }
  | { ok: false; error: string };

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildMatcher(opts: FindOptions): MatcherResult {
  if (!opts.needle) {
    return { ok: false, error: "请输入查找内容" };
  }
  const flags = opts.matchCase ? "g" : "gi";
  try {
    const source = opts.regex ? opts.needle : escapeRegExp(opts.needle);
    return { ok: true, re: new RegExp(source, flags) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "非法正则表达式",
    };
  }
}

function previewAt(text: string, index: number): string {
  const lineStart = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  let lineEnd = text.indexOf("\n", index);
  if (lineEnd < 0) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

/** Count newlines in text[0..end) without allocating a split array. */
function lineNumberAt(text: string, index: number, from: number, line: number): number {
  let n = line;
  for (let i = from; i < index; i++) {
    if (text.charCodeAt(i) === 10) n += 1;
  }
  return n;
}

/** Max matches shown by「查找全部」in one query. */
export const FIND_RESULT_LIMIT = 1000;

export function findAll(
  text: string,
  opts: FindOptions,
  /** Stop after this many matches; sets truncated when more exist. */
  limit?: number,
): { matches: MatchHit[]; error?: string; truncated?: boolean } {
  const matcher = buildMatcher(opts);
  if (!matcher.ok) return { matches: [], error: matcher.error };
  const matches: MatchHit[] = [];
  const re = matcher.re;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let guard = 0;
  let scanFrom = 0;
  let line = 1;
  let truncated = false;
  while ((m = re.exec(text)) !== null) {
    const length = m[0].length;
    line = lineNumberAt(text, m.index, scanFrom, line);
    scanFrom = m.index;
    if (limit != null && matches.length >= limit) {
      truncated = true;
      break;
    }
    matches.push({
      index: m.index,
      length,
      line,
      preview: previewAt(text, m.index),
    });
    if (length === 0) re.lastIndex = m.index + 1;
    if (++guard > 100_000) {
      truncated = true;
      break;
    }
  }
  return truncated ? { matches, truncated } : { matches };
}

export function findNext(
  text: string,
  opts: FindOptions,
  from: number,
  wrap: boolean,
): { hit: MatchHit | null; error?: string; wrapped?: boolean } {
  const { matches, error } = findAll(text, opts);
  if (error) return { hit: null, error };
  if (!matches.length) return { hit: null };
  const after = matches.find((m) => m.index >= from);
  if (after) return { hit: after, wrapped: false };
  if (wrap) return { hit: matches[0], wrapped: true };
  return { hit: null };
}

export function findPrev(
  text: string,
  opts: FindOptions,
  from: number,
  wrap: boolean,
): { hit: MatchHit | null; error?: string; wrapped?: boolean } {
  const { matches, error } = findAll(text, opts);
  if (error) return { hit: null, error };
  if (!matches.length) return { hit: null };
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (m.index + m.length <= from) return { hit: m, wrapped: false };
  }
  if (wrap) return { hit: matches[matches.length - 1], wrapped: true };
  return { hit: null };
}

export function currentMatchIndex(
  matches: MatchHit[],
  selStart: number,
  selEnd: number,
): number {
  if (!matches.length) return -1;
  const exact = matches.findIndex(
    (m) => m.index === selStart && m.index + m.length === selEnd,
  );
  if (exact >= 0) return exact;
  return matches.findIndex(
    (m) => selStart >= m.index && selStart <= m.index + m.length,
  );
}

export function replaceOne(
  text: string,
  opts: FindOptions,
  replacement: string,
  selStart: number,
  selEnd: number,
): { text: string; nextCaret: number; replaced: boolean; error?: string } {
  const { matches, error } = findAll(text, opts);
  if (error) return { text, nextCaret: selEnd, replaced: false, error };
  const hit = matches.find(
    (m) => m.index === selStart && m.index + m.length === selEnd,
  );
  if (!hit) return { text, nextCaret: selEnd, replaced: false };

  const matched = text.slice(hit.index, hit.index + hit.length);
  let replacedText = replacement;
  if (opts.regex) {
    const oneShot = new RegExp(
      opts.regex ? opts.needle : escapeRegExp(opts.needle),
      opts.matchCase ? "" : "i",
    );
    replacedText = matched.replace(oneShot, replacement);
  }
  const next = text.slice(0, hit.index) + replacedText + text.slice(hit.index + hit.length);
  return {
    text: next,
    nextCaret: hit.index + replacedText.length,
    replaced: true,
  };
}

export function replaceAll(
  text: string,
  opts: FindOptions,
  replacement: string,
): { text: string; count: number; error?: string } {
  const matcher = buildMatcher(opts);
  if (!matcher.ok) return { text, count: 0, error: matcher.error };
  let count = 0;
  const next = text.replace(matcher.re, (...args: unknown[]) => {
    count += 1;
    if (!opts.regex) return replacement;
    const match = String(args[0]);
    const oneShot = new RegExp(matcher.re.source, opts.matchCase ? "" : "i");
    return match.replace(oneShot, replacement);
  });
  return { text: next, count };
}
