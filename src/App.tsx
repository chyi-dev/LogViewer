import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  DisplayBlock,
  DocTab,
  OpenedDocument,
  ParseEvent,
  ParseResponse,
  RuleSummary,
  ViewportRange,
} from "./types";
import FindReplaceDialog, {
  type FindReplaceHandle,
} from "./dialogs/FindReplaceDialog";
import CodeEditor, { type CodeEditorHandle } from "./editor/CodeEditor";
import { currentMatchIndex, type MatchHit } from "./editor/findEngine";
import appreciateQr from "./assets/appreciate.jpg";
import AppToolbar from "./shell/AppToolbar";
import SettingsDialog from "./shell/SettingsDialog";
import { useAppearance } from "./theme/useAppearance";
import "./styles/tokens.css";
import "./styles/palettes.css";
import "./styles/shell.css";
import "./styles/workbench.css";

const PARSE_MIN_BUFFER = 80;
const PARSE_EDGE_MARGIN = 20;
const LOG_FILE_EXTENSIONS = ["txt", "log", "alog", "xlog", "logs"];

function cacheWindow(
  visible: ViewportRange,
  lineCount: number,
): ViewportRange {
  const span = Math.max(visible.toLine - visible.fromLine + 1, PARSE_MIN_BUFFER);
  return {
    fromLine: Math.max(1, visible.fromLine - span),
    toLine: Math.min(lineCount, visible.toLine + span),
  };
}

function cacheCovers(
  cache: ViewportRange | null,
  visible: ViewportRange,
  lineCount: number,
): boolean {
  if (!cache) return false;
  if (visible.fromLine < cache.fromLine || visible.toLine > cache.toLine) {
    return false;
  }
  const leftOk =
    cache.fromLine <= 1 ||
    visible.fromLine - cache.fromLine >= PARSE_EDGE_MARGIN;
  const rightOk =
    cache.toLine >= lineCount ||
    cache.toLine - visible.toLine >= PARSE_EDGE_MARGIN;
  return leftOk && rightOk;
}

let seq = 1;

function ParseBlockView({ block }: { block: DisplayBlock }) {
  switch (block.type) {
    case "heading":
      return <div className="parse-block-heading">{block.text}</div>;
    case "kv":
      return (
        <div className={`parse-prop${block.fault ? " fault" : ""}`}>
          <span>{block.label}</span>
          <b className="mono">{block.value}</b>
        </div>
      );
    case "status":
      return (
        <div className={`parse-prop${block.fault ? " fault" : ""}`}>
          <span>{block.label}</span>
          <b className={block.fault ? "bad" : undefined}>{block.value}</b>
        </div>
      );
    case "flags":
      return (
        <div className="parse-prop fault">
          <span>故障</span>
          <b className="bad">{block.items.join(" · ")}</b>
        </div>
      );
    case "hex":
      return (
        <div className="parse-prop hex">
          <span>{block.label}</span>
          <code>{block.value}</code>
        </div>
      );
    default:
      return null;
  }
}

function parseStatusLabel(e: ParseEvent): string {
  const blocks = e.blocks ?? [];
  for (const b of blocks) {
    if (b.type === "status" && b.value) return b.value;
  }
  return "";
}

function parseFaultSummary(e: ParseEvent): string {
  const blocks = e.blocks ?? [];
  for (const b of blocks) {
    if (b.type === "flags" && b.items.length > 0) {
      return b.items.join(" · ");
    }
  }
  const clauses = e.clauses ?? [];
  const faultTexts = clauses
    .filter((c) => c.fault && c.text.trim())
    .map((c) => c.text.trim());
  return faultTexts.join(" · ");
}

const FONT_SIZE_KEY = "logviewer.editorFontSize";
const FONT_SIZE_DEFAULT = 12.5;
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 24;
const FONT_SIZE_STEP = 1;

function loadFontSize(): number {
  try {
    const raw = localStorage.getItem(FONT_SIZE_KEY);
    if (raw == null) return FONT_SIZE_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return FONT_SIZE_DEFAULT;
    return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n));
  } catch {
    return FONT_SIZE_DEFAULT;
  }
}

function clampFontSize(n: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n));
}

function newEmptyTab(): DocTab {
  return {
    id: `doc-${seq++}`,
    name: "未命名.txt",
    path: "",
    encoding: "UTF-8",
    lineEnding: "CRLF",
    dirty: false,
  };
}

function fromOpened(doc: OpenedDocument): DocTab {
  return {
    id: `doc-${seq++}`,
    name: doc.name,
    path: doc.path,
    encoding: doc.encoding,
    lineEnding: doc.line_ending,
    dirty: false,
  };
}

export default function App() {
  const [docs, setDocs] = useState<DocTab[]>(() => [newEmptyTab()]);
  const [activeId, setActiveId] = useState(() => docs[0]?.id ?? "");
  const [parseOpen, setParseOpen] = useState(false);
  const [parseFollow, setParseFollow] = useState(true);
  const [events, setEvents] = useState<ParseEvent[]>([]);
  const [cacheRange, setCacheRange] = useState<ViewportRange | null>(null);
  const [visibleRange, setVisibleRange] = useState<ViewportRange>({
    fromLine: 1,
    toLine: 1,
  });
  const [ruleName, setRuleName] = useState("无规则");
  const [editorCtx, setEditorCtx] = useState<{
    line: number;
    x: number;
    y: number;
  } | null>(null);
  const [rules, setRules] = useState<RuleSummary[]>([]);
  const [wrap, setWrap] = useState(false);
  const [fontSize, setFontSize] = useState(loadFontSize);
  const appearance = useAppearance();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [findMode, setFindMode] = useState<"find" | "replace" | null>(null);
  const [findAllOpen, setFindAllOpen] = useState(false);
  const [findAllMatches, setFindAllMatches] = useState<MatchHit[]>([]);
  const [findAllQuery, setFindAllQuery] = useState("");
  const [findResultsHeight, setFindResultsHeight] = useState(180);
  const [parseWidth, setParseWidth] = useState(420);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [passOpen, setPassOpen] = useState<"export" | "import" | "encrypt" | "decrypt" | null>(null);
  const [rulesManageOpen, setRulesManageOpen] = useState(false);
  const [appreciateOpen, setAppreciateOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [gotoLine, setGotoLine] = useState("1");
  const [passphrase, setPassphrase] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [caret, setCaret] = useState({ line: 1, col: 1 });
  const [selectedParseLine, setSelectedParseLine] = useState<number | null>(null);
  const [openParseId, setOpenParseId] = useState<string | null>(null);
  const [selRange, setSelRange] = useState({ start: 0, end: 0 });
  const [docVersion, setDocVersion] = useState(0);

  const editorRef = useRef<CodeEditorHandle>(null);
  const parseTimer = useRef<number | null>(null);
  const parseReqRef = useRef(0);
  const cacheRangeRef = useRef<ViewportRange | null>(null);
  const parseListRef = useRef<HTMLDivElement>(null);
  const caretLocateTimer = useRef<number | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const findRef = useRef<FindReplaceHandle>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const editorStackRef = useRef<HTMLDivElement>(null);
  const vSplitDragging = useRef(false);
  const hSplitDragging = useRef(false);
  const initialDocReady = useRef(false);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const docsRef = useRef(docs);
  docsRef.current = docs;
  cacheRangeRef.current = cacheRange;

  const active = docs.find((d) => d.id === activeId) ?? null;

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  const updateActive = useCallback((mut: (t: DocTab) => DocTab) => {
    setDocs((prev) => prev.map((d) => (d.id === activeIdRef.current ? mut(d) : d)));
  }, []);

  const markDirty = useCallback((id: string) => {
    setDocs((prev) =>
      prev.map((d) => (d.id === id && !d.dirty ? { ...d, dirty: true } : d)),
    );
  }, []);

  const refreshRules = async () => {
    try {
      const list = await invoke<RuleSummary[]>("list_rules");
      setRules(list);
      const activeRule = list.find((r) => r.active);
      setRuleName(activeRule?.name ?? "无规则");
    } catch (e) {
      showToast(String(e));
    }
  };

  const clearParseCache = () => {
    setEvents([]);
    setCacheRange(null);
    cacheRangeRef.current = null;
  };

  const runParseWindow = useCallback(async (force = false) => {
    const ed = editorRef.current;
    if (!ed) return null;
    if (!rules.some((r) => r.active)) {
      clearParseCache();
      setRuleName("无规则");
      return [];
    }
    const visible = ed.getViewport();
    const lineCount = ed.getLineCount();
    setVisibleRange(visible);
    if (!force && cacheCovers(cacheRangeRef.current, visible, lineCount)) {
      return eventsRef.current;
    }
    const win = cacheWindow(visible, lineCount);
    const lines = ed.getLines(win.fromLine, win.toLine);
    const req = ++parseReqRef.current;
    try {
      const res = await invoke<ParseResponse>("parse_window", { lines });
      if (req !== parseReqRef.current) return null;
      setEvents(res.events);
      setCacheRange(win);
      setRuleName(res.rule_name || "无规则");
      return res.events;
    } catch (e) {
      if (req !== parseReqRef.current) return null;
      showToast(String(e));
      return null;
    }
  }, [rules]);

  const runParseAroundLine = useCallback(async (lineNo: number) => {
    const ed = editorRef.current;
    if (!ed) return [] as ParseEvent[];
    if (!rules.some((r) => r.active)) {
      clearParseCache();
      setRuleName("无规则");
      return [];
    }
    const lineCount = ed.getLineCount();
    const win = cacheWindow(
      { fromLine: lineNo, toLine: lineNo },
      lineCount,
    );
    const lines = ed.getLines(win.fromLine, win.toLine);
    const req = ++parseReqRef.current;
    try {
      const res = await invoke<ParseResponse>("parse_window", { lines });
      if (req !== parseReqRef.current) return eventsRef.current;
      setEvents(res.events);
      setCacheRange(win);
      setRuleName(res.rule_name || "无规则");
      return res.events;
    } catch (e) {
      if (req !== parseReqRef.current) return eventsRef.current;
      showToast(String(e));
      return [];
    }
  }, [rules]);

  const switchRule = async (id: string) => {
    try {
      await invoke("set_active_rule", { id });
      await refreshRules();
      clearParseCache();
      if (parseOpen) await runParseWindow(true);
    } catch (e) {
      showToast(String(e));
    }
  };

  const openRulesManage = () => {
    setDeleteConfirmId(null);
    setRulesManageOpen(true);
  };

  const deleteRule = async (id: string) => {
    const wasActive = rules.find((r) => r.id === id)?.active ?? false;
    try {
      await invoke("delete_rule", { id });
      setDeleteConfirmId(null);
      const list = await invoke<RuleSummary[]>("list_rules");
      setRules(list);
      const activeRule = list.find((r) => r.active);
      setRuleName(activeRule?.name ?? "无规则");
      if (wasActive) {
        clearParseCache();
        if (parseOpen && activeRule) await runParseWindow(true);
      }
      showToast("规则已删除");
    } catch (e) {
      showToast(String(e));
    }
  };

  const alignParseFrame = useCallback((lineNo: number) => {
    const list = parseListRef.current;
    const frame = list?.querySelector(`[data-parse-line="${lineNo}"]`);
    if (!list || !(frame instanceof HTMLElement)) return;
    const lineTop = editorRef.current?.getLineScreenTop(lineNo);
    if (lineTop == null) return;
    const targetScroll =
      list.scrollTop + (frame.getBoundingClientRect().top - lineTop);
    const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    if (targetScroll < -0.5 || targetScroll > maxScroll + 0.5) return;
    const next = Math.max(0, Math.min(maxScroll, targetScroll));
    if (Math.abs(next - list.scrollTop) < 1) return;
    list.scrollTo({ top: next, behavior: "smooth" });
  }, []);

  const onViewportChange = useCallback(
    (range: ViewportRange) => {
      setVisibleRange(range);
      if (!parseOpen) return;
      const lineCount = editorRef.current?.getLineCount() ?? 1;
      if (cacheCovers(cacheRangeRef.current, range, lineCount)) return;
      if (parseTimer.current) window.clearTimeout(parseTimer.current);
      parseTimer.current = window.setTimeout(() => {
        void runParseWindow(false);
      }, 80);
    },
    [parseOpen, runParseWindow],
  );

  useEffect(() => {
    refreshRules();
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--editor-font-size",
      `${fontSize}px`,
    );
    try {
      localStorage.setItem(FONT_SIZE_KEY, String(fontSize));
    } catch {
      /* ignore quota / private mode */
    }
  }, [fontSize]);

  const bumpFont = (delta: number) => {
    setFontSize((n) => clampFontSize(n + delta));
  };
  const resetFont = () => setFontSize(FONT_SIZE_DEFAULT);

  // Ensure the first empty tab has a CodeMirror document once the editor mounts.
  useEffect(() => {
    if (initialDocReady.current) return;
    const id = activeId;
    const ed = editorRef.current;
    if (!ed || !id) return;
    if (!ed.hasDocument(id)) ed.openDocument(id, "");
    initialDocReady.current = true;
  }, [activeId, docVersion]);

  useEffect(() => {
    if (!parseOpen) return;
    setCacheRange(null);
    cacheRangeRef.current = null;
    if (parseTimer.current) window.clearTimeout(parseTimer.current);
    parseTimer.current = window.setTimeout(() => {
      void runParseWindow(true);
    }, 120);
    return () => {
      if (parseTimer.current) window.clearTimeout(parseTimer.current);
    };
  }, [docVersion, parseOpen, activeId, runParseWindow]);

  const visibleEvents = events.filter(
    (e) => e.line >= visibleRange.fromLine && e.line <= visibleRange.toLine,
  );

  // Follow mode: align parse frame with caret when scroll room allows.
  useEffect(() => {
    if (!parseOpen || !parseFollow) return;
    const hit = events.find((e) => e.line === caret.line);
    if (!hit) return;
    if (caretLocateTimer.current) window.clearTimeout(caretLocateTimer.current);
    caretLocateTimer.current = window.setTimeout(() => {
      setSelectedParseLine(hit.line);
      alignParseFrame(hit.line);
    }, 60);
    return () => {
      if (caretLocateTimer.current) window.clearTimeout(caretLocateTimer.current);
    };
  }, [caret.line, events, parseOpen, parseFollow, alignParseFrame]);

  const focusParseLine = useCallback(
    async (lineNo: number) => {
      setEditorCtx(null);
      setParseOpen(true);
      const list = await runParseAroundLine(lineNo);
      const hit = list.find((e) => e.line === lineNo);
      if (!hit) {
        showToast(`第 ${lineNo} 行无法解析`);
        return;
      }
      setSelectedParseLine(lineNo);
      // Wait for pane layout + list paint after opening.
      window.setTimeout(() => alignParseFrame(lineNo), 80);
      window.setTimeout(() => alignParseFrame(lineNo), 220);
    },
    [runParseAroundLine, alignParseFrame],
  );

  const jumpToLine = (lineNo: number) => {
    editorRef.current?.gotoLine(lineNo);
  };

  const undo = () => {
    editorRef.current?.undo();
  };
  const redo = () => {
    editorRef.current?.redo();
  };

  const switchTab = (id: string) => {
    if (id === activeId) return;
    setActiveId(id);
    setEvents([]);
    setCacheRange(null);
    cacheRangeRef.current = null;
    setSelectedParseLine(null);
    setOpenParseId(null);
  };

  const closeTab = (id: string) => {
    const tab = docs.find((d) => d.id === id);
    if (tab?.dirty && !window.confirm(`关闭 ${tab.name}？未保存的更改将丢失。`)) return;
    const idx = docs.findIndex((d) => d.id === id);
    const next = docs.filter((d) => d.id !== id);
    editorRef.current?.closeDocument(id);
    if (!next.length) {
      const empty = newEmptyTab();
      editorRef.current?.openDocument(empty.id, "");
      setDocs([empty]);
      setActiveId(empty.id);
      return;
    }
    setDocs(next);
    if (id === activeId) setActiveId(next[Math.max(0, idx - 1)].id);
  };

  const openPathsFromShell = useCallback(async (paths: string[]) => {
    for (const selectedPath of paths) {
      if (!selectedPath) continue;
      const existing = docsRef.current.find((d) => d.path === selectedPath);
      if (existing) {
        setActiveId(existing.id);
        continue;
      }
      try {
        const doc = await invoke<OpenedDocument>("open_document", { path: selectedPath });
        if (doc.encoding_warning) showToast(doc.encoding_warning);
        const tab = fromOpened(doc);
        editorRef.current?.openDocument(tab.id, doc.text);
        setDocs((prev) => {
          const aloneEmpty =
            prev.length === 1 &&
            !prev[0].path &&
            !prev[0].dirty &&
            prev[0].name === "未命名.txt";
          if (aloneEmpty) {
            editorRef.current?.closeDocument(prev[0].id);
            return [tab];
          }
          return [...prev, tab];
        });
        setActiveId(tab.id);
      } catch (e) {
        showToast(String(e));
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        unlisten = await listen<string[]>("open-files", (ev) => {
          void openPathsFromShell(ev.payload ?? []);
        });
        const pending = await invoke<string[]>("take_launch_files");
        if (!cancelled && pending?.length) {
          void openPathsFromShell(pending);
        }
      } catch (e) {
        if (!cancelled) showToast(String(e));
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [openPathsFromShell]);

  const openFile = async () => {
    const selectedPath = await open({
      multiple: false,
      filters: [
        { name: "Log / Text", extensions: [...LOG_FILE_EXTENSIONS] },
        { name: "All", extensions: ["*"] },
      ],
    });
    if (!selectedPath || Array.isArray(selectedPath)) return;
    await openPathsFromShell([selectedPath]);
  };

  const saveFile = async (saveAs = false) => {
    if (!active) return;
    let path = active.path;
    if (saveAs || !path) {
      const picked = await save({
        defaultPath: active.name,
        filters: [{ name: "Log / Text", extensions: [...LOG_FILE_EXTENSIONS] }],
      });
      if (!picked) return;
      path = picked;
    }
    try {
      const text = editorRef.current?.getText() ?? "";
      await invoke("save_document", {
        path,
        text,
        encoding: active.encoding,
        lineEnding: active.lineEnding,
      });
      updateActive((t) => ({
        ...t,
        path,
        name: path.split(/[/\\]/).pop() || t.name,
        dirty: false,
      }));
    } catch (e) {
      showToast(String(e));
    }
  };

  const selectInEditor = (start: number, end: number) => {
    editorRef.current?.selectRange(start, end);
  };

  const applyReplacedText = (next: string, caretPos: number) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.setDocument(next);
    ed.selectRange(caretPos, caretPos);
  };

  const openFind = (mode: "find" | "replace") => {
    setFindMode(mode);
  };

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      if (vSplitDragging.current && editorStackRef.current) {
        const rect = editorStackRef.current.getBoundingClientRect();
        const fromBottom = rect.bottom - ev.clientY;
        setFindResultsHeight(Math.min(Math.max(80, fromBottom), Math.max(80, rect.height - 120)));
      }
      if (hSplitDragging.current && workspaceRef.current) {
        const rect = workspaceRef.current.getBoundingClientRect();
        const fromRight = rect.right - ev.clientX;
        setParseWidth(Math.min(Math.max(240, fromRight), Math.max(240, rect.width - 240)));
      }
    };
    const onUp = () => {
      vSplitDragging.current = false;
      hSplitDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const insertDateTime = () => {
    const stamp = new Date().toLocaleString();
    editorRef.current?.insertText(stamp);
  };

  const doExport = async () => {
    try {
      const bytes = await invoke<number[]>("export_rule", { passphrase });
      const path = await save({
        defaultPath: `${ruleName}.lvrule`,
        filters: [{ name: "LogViewer Rule", extensions: ["lvrule"] }],
      });
      if (!path) return;
      await writeBinary(path, Uint8Array.from(bytes));
      setPassOpen(null);
      setPassphrase("");
      showToast("规则已导出");
    } catch (e) {
      showToast(String(e));
    }
  };

  const doImport = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "LogViewer Rule", extensions: ["lvrule"] }],
      });
      if (!path || Array.isArray(path)) return;
      const data = await readBinary(path);
      await invoke("import_rule", { data: Array.from(data), passphrase });
      await refreshRules();
      clearParseCache();
      if (parseOpen) await runParseWindow(true);
      setPassOpen(null);
      setPassphrase("");
      showToast("规则已导入");
    } catch (e) {
      showToast(String(e));
    }
  };

  const doEncrypt = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Rule JSON", extensions: ["json"] }],
      });
      if (!path || Array.isArray(path)) return;
      const data = await readBinary(path);
      const json = new TextDecoder("utf-8").decode(data);
      const bytes = await invoke<number[]>("encrypt_rule_json", { json, passphrase });
      const base = path.replace(/\\/g, "/").split("/").pop()?.replace(/\.json$/i, "") || "rule";
      const out = await save({
        defaultPath: `${base}.lvrule`,
        filters: [{ name: "LogViewer Rule", extensions: ["lvrule"] }],
      });
      if (!out) return;
      await writeBinary(out, Uint8Array.from(bytes));
      setPassOpen(null);
      setPassphrase("");
      showToast("规则已加密");
    } catch (e) {
      showToast(String(e));
    }
  };

  const doDecrypt = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "LogViewer Rule", extensions: ["lvrule"] }],
      });
      if (!path || Array.isArray(path)) return;
      const data = await readBinary(path);
      const json = await invoke<string>("decrypt_rule_file", {
        data: Array.from(data),
        passphrase,
      });
      const base = path.replace(/\\/g, "/").split("/").pop()?.replace(/\.lvrule$/i, "") || "rule";
      const out = await save({
        defaultPath: `${base}.json`,
        filters: [{ name: "Rule JSON", extensions: ["json"] }],
      });
      if (!out) return;
      await writeBinary(out, new TextEncoder().encode(json));
      setPassOpen(null);
      setPassphrase("");
      showToast("规则已解密");
    } catch (e) {
      showToast(String(e));
    }
  };

  const passTitle =
    passOpen === "export"
      ? "导出规则"
      : passOpen === "import"
        ? "导入规则"
        : passOpen === "encrypt"
          ? "加密规则"
          : "解密规则";

  const passActionLabel =
    passOpen === "export"
      ? "导出"
      : passOpen === "import"
        ? "选择文件并导入"
        : passOpen === "encrypt"
          ? "选择 JSON 并加密"
          : "选择文件并解密";

  const runPassAction = () => {
    if (passOpen === "export") void doExport();
    else if (passOpen === "import") void doImport();
    else if (passOpen === "encrypt") void doEncrypt();
    else if (passOpen === "decrypt") void doDecrypt();
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const mod = ev.ctrlKey || ev.metaKey;
      if (mod && ev.shiftKey && (ev.key === "P" || ev.key === "p")) {
        ev.preventDefault();
        setParseOpen((v) => !v);
        return;
      }
      if (mod && (ev.key === "f" || ev.key === "F")) {
        ev.preventDefault();
        openFind("find");
        return;
      }
      if (mod && (ev.key === "h" || ev.key === "H")) {
        ev.preventDefault();
        openFind("replace");
        return;
      }
      if (mod && (ev.key === "g" || ev.key === "G")) {
        ev.preventDefault();
        setGotoOpen(true);
        return;
      }
      if (mod && (ev.key === "s" || ev.key === "S")) {
        ev.preventDefault();
        saveFile(ev.shiftKey);
        return;
      }
      if (mod && (ev.key === "o" || ev.key === "O")) {
        ev.preventDefault();
        openFile();
        return;
      }
      if (mod && (ev.key === "n" || ev.key === "N")) {
        ev.preventDefault();
        const t = newEmptyTab();
        editorRef.current?.openDocument(t.id, "");
        setDocs((p) => [...p, t]);
        setActiveId(t.id);
        return;
      }
      if (mod && (ev.key === "w" || ev.key === "W")) {
        ev.preventDefault();
        if (activeId) closeTab(activeId);
        return;
      }
      if (mod && (ev.key === "=" || ev.key === "+" || ev.key === "Add")) {
        ev.preventDefault();
        bumpFont(FONT_SIZE_STEP);
        return;
      }
      if (mod && (ev.key === "-" || ev.key === "_" || ev.key === "Subtract")) {
        ev.preventDefault();
        bumpFont(-FONT_SIZE_STEP);
        return;
      }
      if (mod && ev.key === "0") {
        ev.preventDefault();
        resetFont();
        return;
      }
      // Undo/redo: let CodeMirror handle when focused; menu still calls undo()/redo().
      if (ev.key === "F3") {
        ev.preventDefault();
        if (!findMode) openFind("find");
        requestAnimationFrame(() => {
          if (ev.shiftKey) findRef.current?.findPrev();
          else findRef.current?.findNext();
        });
        return;
      }
      if (ev.key === "F5") {
        ev.preventDefault();
        insertDateTime();
        return;
      }
      if (ev.key === "Escape") {
        setFindMode(null);
        setGotoOpen(false);
        setPassOpen(null);
        setRulesManageOpen(false);
        setDeleteConfirmId(null);
        setAppreciateOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="app">
      <AppToolbar
        parseOpen={parseOpen}
        wrap={wrap}
        themeMode={appearance.state.mode}
        ruleName={ruleName}
        rules={rules}
        onToast={showToast}
        onNew={() => {
          const t = newEmptyTab();
          editorRef.current?.openDocument(t.id, "");
          setDocs((p) => [...p, t]);
          setActiveId(t.id);
        }}
        onOpen={() => {
          void openFile();
        }}
        onSave={() => {
          void saveFile(false);
        }}
        onSaveAs={() => {
          void saveFile(true);
        }}
        onCloseTab={() => {
          if (activeId) closeTab(activeId);
        }}
        onFind={() => openFind("find")}
        onReplace={() => openFind("replace")}
        onGoto={() => setGotoOpen(true)}
        onToggleParse={() => setParseOpen((v) => !v)}
        onToggleWrap={() => setWrap((v) => !v)}
        onBumpFont={bumpFont}
        onResetFont={resetFont}
        onManageRules={openRulesManage}
        onExportRules={() => setPassOpen("export")}
        onImportRules={() => setPassOpen("import")}
        onEncryptRules={() => setPassOpen("encrypt")}
        onDecryptRules={() => setPassOpen("decrypt")}
        onAppreciate={() => setAppreciateOpen(true)}
        onUndo={undo}
        onRedo={redo}
        onSelectAll={() => {
          editorRef.current?.selectAll();
        }}
        onInsertDateTime={insertDateTime}
        onSwitchRule={(id) => {
          void switchRule(id);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onCycleTheme={appearance.setMode}
      />

      <div className="tabs">
        {docs.map((d) => (
          <div
            key={d.id}
            className={`tab${d.id === activeId ? " active" : ""}`}
            onClick={() => switchTab(d.id)}
            title={d.path || d.name}
          >
            <span className="name">
              {d.dirty ? <span className="dirty">● </span> : null}
              {d.name}
            </span>
            <button
              type="button"
              className="x"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(d.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="tab-add" title="打开" onClick={() => openFile()}>
          +
        </button>
      </div>

      <div
        ref={workspaceRef}
        className={`workspace${parseOpen ? " parse-on" : ""}`}
      >
        <section className="editor-pane">
          <div className="editor-stack" ref={editorStackRef}>
            <div className="editor-wrap">
              <CodeEditor
                ref={editorRef}
                activeId={activeId}
                wrap={wrap}
                onCaretChange={(c, sel) => {
                  setCaret(c);
                  setSelRange(sel);
                }}
                onDirty={markDirty}
                onDocVersion={setDocVersion}
                onViewportChange={onViewportChange}
                onContextMenu={(info) => setEditorCtx(info)}
              />
            </div>

            {findAllOpen ? (
              <>
                <div
                  className="v-split"
                  onMouseDown={(e) => {
                    vSplitDragging.current = true;
                    document.body.style.cursor = "row-resize";
                    document.body.style.userSelect = "none";
                    e.preventDefault();
                  }}
                />
                <div className="find-results-pane" style={{ height: findResultsHeight }}>
                  <div className="find-results-head">
                    <span>
                      <strong>查找结果</strong>
                      {" · "}
                      {findAllQuery ? `"${findAllQuery}" · ` : ""}
                      {findAllMatches.length} 项
                    </span>
                    <button
                      type="button"
                      className="close-find-results"
                      onClick={() => {
                        setFindAllOpen(false);
                        setFindAllMatches([]);
                      }}
                    >
                      关闭
                    </button>
                  </div>
                  <div className="find-results-list">
                    {!findAllMatches.length ? (
                      <div className="empty-parse">无匹配项</div>
                    ) : (
                      findAllMatches.map((m, i) => {
                        const cur = currentMatchIndex(
                          findAllMatches,
                          selRange.start,
                          selRange.end,
                        );
                        return (
                          <button
                            type="button"
                            key={`${m.index}-${i}`}
                            className={`find-all-item${i === cur ? " current" : ""}`}
                            onClick={() => selectInEditor(m.index, m.index + m.length)}
                          >
                            <span className="find-all-line">L{m.line}</span>
                            <span className="find-all-preview">{m.preview || "(空行)"}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </section>

        {parseOpen ? (
          <div
            className="h-split"
            onMouseDown={(e) => {
              hSplitDragging.current = true;
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
              e.preventDefault();
            }}
          />
        ) : null}

        <aside
          className="parse-pane"
          style={parseOpen ? { width: parseWidth } : undefined}
        >
          <div className="parse-head">
            <span><strong>解析结果 · {ruleName}</strong></span>
            <div className="parse-head-actions">
              <button
                type="button"
                className={`follow-parse${parseFollow ? " on" : ""}`}
                onClick={() => setParseFollow((v) => !v)}
                title={parseFollow ? "关闭跟随模式" : "开启跟随模式"}
              >
                {parseFollow ? "跟随：开" : "跟随：关"}
              </button>
              <button type="button" className="close-parse" onClick={() => setParseOpen(false)}>关闭</button>
            </div>
          </div>
          <div className="byte-list" ref={parseListRef}>
            {!active ? (
              <div className="empty-parse">打开一个日志标签后，可在此查看解析结果。</div>
            ) : visibleEvents.length === 0 ? (
              <div className="empty-parse">当前可视区域暂无解析帧。滚动日志或点击「解析当前标签」。</div>
            ) : (
              visibleEvents.map((e) => {
                const blocks = e.blocks ?? [];
                const clauses = e.clauses ?? [];
                const bytes = e.bytes ?? [];
                const status = parseStatusLabel(e);
                const faultSummary = e.fault ? parseFaultSummary(e) : "";
                const isOpen = openParseId === e.id;
                const expandBlocks = blocks.filter((b) => b.type !== "heading");
                return (
                  <div
                    key={e.id}
                    data-parse-line={e.line}
                    className={`parse-row${e.line === selectedParseLine ? " active" : ""}${e.fault ? " fault" : ""}${isOpen ? " open" : ""}`}
                    onClick={() => {
                      setSelectedParseLine(e.line);
                      jumpToLine(e.line);
                      setOpenParseId((cur) => (cur === e.id ? null : e.id));
                    }}
                  >
                    <div className="parse-summary">
                      <span className="parse-no">L{e.line}</span>
                      <span className="parse-dir">{e.dir === "tx" ? "发送" : "接收"}</span>
                      <span className="parse-row-title">{e.title}</span>
                      {status ? <span className="parse-status">{status}</span> : <span className="parse-status" />}
                      {faultSummary ? (
                        <div className="parse-fault-line">{faultSummary}</div>
                      ) : null}
                    </div>
                    {isOpen ? (
                      <div className="parse-expand">
                        {expandBlocks.length > 0 ? (
                          <div className="parse-blocks">
                            {expandBlocks.map((b, i) => (
                              <ParseBlockView key={i} block={b} />
                            ))}
                          </div>
                        ) : clauses.length > 0 ? (
                          <p className="parse-clauses">
                            {clauses.map((c, i) => (
                              <span key={i}>
                                <span className="parse-hx">{c.hex}</span>
                                ：
                                <span className={c.fault ? "parse-mean fault" : "parse-mean"}>
                                  {c.text}
                                </span>
                                ；
                              </span>
                            ))}
                          </p>
                        ) : (
                          bytes.map((b, i) => (
                            <div key={i} className={`byte-row${b.fault ? " fault" : ""}`}>
                              <span className="byte-hex">{b.hex}</span>
                              <span className="byte-text">{b.text}</span>
                            </div>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>

      <div className="statusbar">
        <span>第 {caret.line} 行，第 {caret.col} 列</span>
        <span>{active?.name ?? "—"}</span>
        <span>解析分栏：{parseOpen ? "开" : "关"}</span>
        <div className="right">
          <span>{fontSize}px</span>
          <span>{active?.encoding ?? "UTF-8"}</span>
          <span>{active?.lineEnding ?? "CRLF"}</span>
        </div>
      </div>

      <FindReplaceDialog
        ref={findRef}
        mode={findMode === "replace" ? "replace" : "find"}
        open={findMode !== null}
        docVersion={docVersion}
        getText={() => editorRef.current?.getText() ?? ""}
        selStart={selRange.start}
        selEnd={selRange.end}
        getSelection={() =>
          editorRef.current?.getSelection() ?? { start: 0, end: 0 }
        }
        onSelect={selectInEditor}
        onReplaceText={applyReplacedText}
        onFindAllResults={(matches, query) => {
          setFindAllMatches(matches);
          setFindAllQuery(query);
          setFindAllOpen(true);
        }}
        onClose={() => setFindMode(null)}
        onToast={showToast}
      />

      <div className={`dialog${gotoOpen ? " show" : ""}`}>
        <h2>转到</h2>
        <div className="row">
          <label>行号</label>
          <input value={gotoLine} onChange={(e) => setGotoLine(e.target.value)} />
        </div>
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => {
              jumpToLine(Math.max(1, parseInt(gotoLine, 10) || 1));
              setGotoOpen(false);
            }}
          >
            转到
          </button>
          <button type="button" onClick={() => setGotoOpen(false)}>关闭</button>
        </div>
      </div>

      <div className={`dialog${passOpen ? " show" : ""}`}>
        <h2>{passTitle}</h2>
        <div className="row">
          <label>口令</label>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </div>
        <div className="actions">
          <button type="button" className="primary" onClick={runPassAction}>
            {passActionLabel}
          </button>
          <button type="button" onClick={() => { setPassOpen(null); setPassphrase(""); }}>取消</button>
        </div>
      </div>

      <div className={`dialog${rulesManageOpen ? " show" : ""}`} style={{ width: 420 }}>
        <h2>管理规则</h2>
        <div className="rule-manage-list">
          {rules.length === 0 ? (
            <div className="rule-manage-empty">暂无规则</div>
          ) : (
            rules.map((r) => (
              <div key={r.id} className="rule-manage-row">
                <div className="rule-manage-meta">
                  <div className="rule-manage-name">
                    {r.name}
                    {r.active ? <span className="rule-manage-badge">当前</span> : null}
                  </div>
                  <div className="rule-manage-ver">v{r.version}</div>
                </div>
                <button
                  type="button"
                  className={`rule-manage-del${deleteConfirmId === r.id ? " confirm" : ""}`}
                  onClick={() => {
                    if (deleteConfirmId === r.id) {
                      void deleteRule(r.id);
                    } else {
                      setDeleteConfirmId(r.id);
                    }
                  }}
                >
                  {deleteConfirmId === r.id ? "确认删除" : "删除"}
                </button>
              </div>
            ))
          )}
        </div>
        <div className="actions">
          <button
            type="button"
            onClick={() => {
              setRulesManageOpen(false);
              setDeleteConfirmId(null);
            }}
          >
            关闭
          </button>
        </div>
      </div>

      {appreciateOpen ? (
        <div
          className="appreciate-backdrop"
          onMouseDown={() => setAppreciateOpen(false)}
        >
          <div
            className="appreciate-card"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2>赞赏作者</h2>
            <p className="appreciate-hint">使用微信扫一扫</p>
            <img
              className="appreciate-qr"
              src={appreciateQr}
              alt="微信赞赏码"
              width={280}
              height={280}
            />
            <div className="actions">
              <button type="button" onClick={() => setAppreciateOpen(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editorCtx ? (
        <div
          className="editor-ctx-backdrop"
          onMouseDown={() => setEditorCtx(null)}
        >
          <div
            className="editor-ctx-menu"
            style={{ left: editorCtx.x, top: editorCtx.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                editorRef.current?.cut();
                setEditorCtx(null);
              }}
            >
              剪切
            </button>
            <button
              type="button"
              onClick={() => {
                editorRef.current?.copy();
                setEditorCtx(null);
              }}
            >
              复制
            </button>
            <button
              type="button"
              onClick={() => {
                void editorRef.current?.paste();
                setEditorCtx(null);
              }}
            >
              粘贴
            </button>
            <button
              type="button"
              onClick={() => {
                editorRef.current?.selectAll();
                setEditorCtx(null);
              }}
            >
              全选
            </button>
            <div className="editor-ctx-sep" />
            <button
              type="button"
              onClick={() => void focusParseLine(editorCtx.line)}
            >
              解析
            </button>
          </div>
        </div>
      ) : null}

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        appearance={appearance}
        fontSize={fontSize}
        wrap={wrap}
        onBumpFont={bumpFont}
        onResetFont={resetFont}
        onToggleWrap={() => setWrap((v) => !v)}
        onAppreciate={() => setAppreciateOpen(true)}
      />

      {toast ? <div className="error-toast">{toast}</div> : null}
    </div>
  );
}

async function writeBinary(path: string, data: Uint8Array) {
  await invoke("write_binary_file", { path, data: Array.from(data) });
}

async function readBinary(path: string): Promise<Uint8Array> {
  const data = await invoke<number[]>("read_binary_file", { path });
  return Uint8Array.from(data);
}
