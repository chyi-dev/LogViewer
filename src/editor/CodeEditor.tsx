import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  EditorState,
  Compartment,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightWhitespace,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  undo as cmUndo,
  redo as cmRedo,
  selectAll as cmSelectAll,
} from "@codemirror/commands";

export interface ViewportRange {
  fromLine: number;
  toLine: number;
}

export interface CodeEditorHandle {
  getText: () => string;
  getSelection: () => { start: number; end: number };
  selectRange: (start: number, end: number) => void;
  gotoLine: (lineNo: number) => void;
  undo: () => boolean;
  redo: () => boolean;
  selectAll: () => boolean;
  cut: () => boolean;
  copy: () => boolean;
  paste: () => Promise<boolean>;
  insertText: (text: string) => void;
  setDocument: (text: string) => void;
  getDocLength: () => number;
  getLineCount: () => number;
  getViewport: () => ViewportRange;
  getLines: (fromLine: number, toLine: number) => { line: number; text: string }[];
  /** Screen Y of the top of a document line, or null if not measurable. */
  getLineScreenTop: (lineNo: number) => number | null;
  focus: () => void;
  openDocument: (id: string, text: string) => void;
  closeDocument: (id: string) => void;
  switchDocument: (id: string) => void;
  hasDocument: (id: string) => boolean;
}

export interface CodeEditorProps {
  activeId: string;
  wrap: boolean;
  showLineNumbers: boolean;
  showWhitespace: boolean;
  onCaretChange: (
    caret: { line: number; col: number },
    sel: { start: number; end: number },
  ) => void;
  onDirty: (id: string) => void;
  onDocVersion: (version: number) => void;
  onViewportChange?: (range: ViewportRange) => void;
  onContextMenu?: (info: { line: number; x: number; y: number }) => void;
}

type ScrollSnap = { x: number; y: number };

function buildTheme(): Extension {
  return EditorView.theme({
    "&": {
      height: "100%",
      fontSize: "var(--editor-font-size)",
      fontFamily: "var(--mono)",
      backgroundColor: "transparent",
      color: "var(--foreground)",
    },
    ".cm-scroller": {
      fontFamily: "var(--mono)",
      lineHeight: "1.6",
      overflow: "auto",
    },
    ".cm-content": {
      padding: "10px 0",
      caretColor: "var(--foreground)",
    },
    ".cm-line": {
      padding: "0 14px 0 4px",
    },
    ".cm-gutters": {
      backgroundColor: "var(--dbx-gutter)",
      color: "var(--muted-foreground)",
      border: "none",
      borderRight: "1px solid var(--border)",
      fontFamily: "var(--mono)",
      fontSize: "var(--editor-font-size)",
      lineHeight: "1.6",
      minWidth: "54px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 8px 0 0",
      minWidth: "46px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--foreground)",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--accent) 70%, transparent)",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
      {
        backgroundColor: "var(--accent)",
      },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--foreground)",
    },
  });
}

const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(
  function CodeEditor(
    {
      activeId,
      wrap,
      showLineNumbers,
      showWhitespace,
      onCaretChange,
      onDirty,
      onDocVersion,
      onViewportChange,
      onContextMenu,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const statesRef = useRef(new Map<string, EditorState>());
    const scrollsRef = useRef(new Map<string, ScrollSnap>());
    const activeIdRef = useRef(activeId);
    const wrapRef = useRef(wrap);
    const lineRef = useRef(showLineNumbers);
    const spaceRef = useRef(showWhitespace);
    const wrapCompartment = useRef(new Compartment());
    const gutterCompartment = useRef(new Compartment());
    const spaceCompartment = useRef(new Compartment());
    const docVersionRef = useRef(0);
    const lastCaretRef = useRef({ line: 1, col: 1, start: 0, end: 0 });
    const lastViewportRef = useRef<ViewportRange>({ fromLine: 1, toLine: 1 });
    const callbacksRef = useRef({
      onCaretChange,
      onDirty,
      onDocVersion,
      onViewportChange,
      onContextMenu,
    });
    callbacksRef.current = {
      onCaretChange,
      onDirty,
      onDocVersion,
      onViewportChange,
      onContextMenu,
    };

    const readViewport = (view: EditorView): ViewportRange => {
      const { from, to } = view.viewport;
      const doc = view.state.doc;
      return {
        fromLine: doc.lineAt(from).number,
        toLine: doc.lineAt(Math.min(to, doc.length)).number,
      };
    };

    const emitViewport = (view: EditorView) => {
      const next = readViewport(view);
      const prev = lastViewportRef.current;
      if (prev.fromLine === next.fromLine && prev.toLine === next.toLine) {
        return;
      }
      lastViewportRef.current = next;
      callbacksRef.current.onViewportChange?.(next);
    };

    const emitCaret = (state: EditorState) => {
      const sel = state.selection.main;
      const line = state.doc.lineAt(sel.head);
      const caret = {
        line: line.number,
        col: sel.head - line.from + 1,
      };
      const range = { start: sel.from, end: sel.to };
      const prev = lastCaretRef.current;
      if (
        prev.line === caret.line &&
        prev.col === caret.col &&
        prev.start === range.start &&
        prev.end === range.end
      ) {
        return;
      }
      lastCaretRef.current = {
        line: caret.line,
        col: caret.col,
        start: range.start,
        end: range.end,
      };
      callbacksRef.current.onCaretChange(caret, range);
    };

    const applyViewOptions = (view: EditorView) => {
      view.dispatch({
        effects: [
          wrapCompartment.current.reconfigure(wrapRef.current ? EditorView.lineWrapping : []),
          gutterCompartment.current.reconfigure(
            lineRef.current ? [lineNumbers(), highlightActiveLineGutter()] : [],
          ),
          spaceCompartment.current.reconfigure(spaceRef.current ? highlightWhitespace() : []),
        ],
      });
    };

    const makeState = (doc: string): EditorState => {
      return EditorState.create({
        doc,
        extensions: [
          highlightActiveLine(),
          history(),
          drawSelection(),
          EditorState.allowMultipleSelections.of(true),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          gutterCompartment.current.of(lineRef.current ? [lineNumbers(), highlightActiveLineGutter()] : []),
          spaceCompartment.current.of(spaceRef.current ? highlightWhitespace() : []),
          wrapCompartment.current.of(wrapRef.current ? EditorView.lineWrapping : []),
          buildTheme(),
          EditorView.domEventHandlers({
            contextmenu: (ev, view) => {
              const pos = view.posAtCoords({
                x: ev.clientX,
                y: ev.clientY,
              });
              if (pos == null) return false;
              ev.preventDefault();
              const line = view.state.doc.lineAt(pos);
              const sel = view.state.selection.main;
              // Keep existing selection when right-clicking inside it.
              if (pos < sel.from || pos > sel.to) {
                view.dispatch({ selection: { anchor: pos } });
              }
              callbacksRef.current.onContextMenu?.({
                line: line.number,
                x: ev.clientX,
                y: ev.clientY,
              });
              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            const id = activeIdRef.current;
            if (update.docChanged) {
              docVersionRef.current += 1;
              callbacksRef.current.onDocVersion(docVersionRef.current);
              callbacksRef.current.onDirty(id);
              const st = update.state;
              statesRef.current.set(id, st);
            } else if (update.selectionSet || update.focusChanged) {
              statesRef.current.set(id, update.state);
            }
            if (update.selectionSet || update.docChanged) {
              emitCaret(update.state);
            }
            if (update.viewportChanged || update.docChanged) {
              emitViewport(update.view);
            }
          }),
        ],
      });
    };

    const saveScroll = (id: string) => {
      const view = viewRef.current;
      if (!view) return;
      scrollsRef.current.set(id, {
        x: view.scrollDOM.scrollLeft,
        y: view.scrollDOM.scrollTop,
      });
    };

    const restoreScroll = (id: string) => {
      const view = viewRef.current;
      if (!view) return;
      const snap = scrollsRef.current.get(id);
      if (!snap) return;
      view.scrollDOM.scrollLeft = snap.x;
      view.scrollDOM.scrollTop = snap.y;
    };

    useEffect(() => {
      if (!hostRef.current) return;
      const initial = makeState("");
      statesRef.current.set(activeId, initial);
      const view = new EditorView({
        state: initial,
        parent: hostRef.current,
      });
      viewRef.current = view;
      emitCaret(view.state);
      emitViewport(view);

      return () => {
        view.destroy();
        viewRef.current = null;
        statesRef.current.clear();
        scrollsRef.current.clear();
      };
      // mount once; documents are managed via imperative API
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      wrapRef.current = wrap;
      lineRef.current = showLineNumbers;
      spaceRef.current = showWhitespace;
      const view = viewRef.current;
      if (!view) return;
      applyViewOptions(view);
      statesRef.current.set(activeIdRef.current, view.state);
    }, [wrap, showLineNumbers, showWhitespace]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const prevId = activeIdRef.current;
      if (prevId === activeId) return;

      saveScroll(prevId);
      statesRef.current.set(prevId, view.state);

      let next = statesRef.current.get(activeId);
      if (!next) {
        next = makeState("");
        statesRef.current.set(activeId, next);
      }
      activeIdRef.current = activeId;
      view.setState(next);
      applyViewOptions(view);
      statesRef.current.set(activeId, view.state);
      requestAnimationFrame(() => restoreScroll(activeId));
      emitCaret(view.state);
      docVersionRef.current += 1;
      callbacksRef.current.onDocVersion(docVersionRef.current);
    }, [activeId]);

    useImperativeHandle(ref, () => ({
      getText: () => viewRef.current?.state.doc.toString() ?? "",
      getSelection: () => {
        const sel = viewRef.current?.state.selection.main;
        if (!sel) return { start: 0, end: 0 };
        return { start: sel.from, end: sel.to };
      },
      selectRange: (start, end) => {
        const view = viewRef.current;
        if (!view) return;
        const max = view.state.doc.length;
        const from = Math.max(0, Math.min(start, max));
        const to = Math.max(0, Math.min(end, max));
        view.dispatch({
          selection: { anchor: from, head: to },
          scrollIntoView: true,
        });
        view.focus();
      },
      gotoLine: (lineNo) => {
        const view = viewRef.current;
        if (!view) return;
        const line = view.state.doc.line(
          Math.max(1, Math.min(lineNo, view.state.doc.lines)),
        );
        view.dispatch({
          selection: { anchor: line.from, head: line.to },
          effects: EditorView.scrollIntoView(line.from, { y: "center" }),
        });
        view.focus();
      },
      undo: () => {
        const view = viewRef.current;
        return view ? cmUndo(view) : false;
      },
      redo: () => {
        const view = viewRef.current;
        return view ? cmRedo(view) : false;
      },
      selectAll: () => {
        const view = viewRef.current;
        return view ? cmSelectAll(view) : false;
      },
      cut: () => {
        const view = viewRef.current;
        if (!view) return false;
        view.focus();
        return document.execCommand("cut");
      },
      copy: () => {
        const view = viewRef.current;
        if (!view) return false;
        view.focus();
        return document.execCommand("copy");
      },
      paste: async () => {
        const view = viewRef.current;
        if (!view) return false;
        view.focus();
        try {
          const text = await navigator.clipboard.readText();
          const sel = view.state.selection.main;
          view.dispatch({
            changes: { from: sel.from, to: sel.to, insert: text },
            selection: { anchor: sel.from + text.length },
          });
          return true;
        } catch {
          return document.execCommand("paste");
        }
      },
      insertText: (text) => {
        const view = viewRef.current;
        if (!view) return;
        const sel = view.state.selection.main;
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length },
        });
        view.focus();
      },
      setDocument: (text) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          selection: { anchor: 0 },
        });
        statesRef.current.set(activeIdRef.current, view.state);
      },
      getDocLength: () => viewRef.current?.state.doc.length ?? 0,
      getLineCount: () => viewRef.current?.state.doc.lines ?? 1,
      getViewport: () => {
        const view = viewRef.current;
        if (!view) return { fromLine: 1, toLine: 1 };
        return readViewport(view);
      },
      getLines: (fromLine, toLine) => {
        const view = viewRef.current;
        if (!view) return [];
        const doc = view.state.doc;
        const start = Math.max(1, Math.min(fromLine, doc.lines));
        const end = Math.max(start, Math.min(toLine, doc.lines));
        const out: { line: number; text: string }[] = [];
        for (let n = start; n <= end; n++) {
          out.push({ line: n, text: doc.line(n).text });
        }
        return out;
      },
      getLineScreenTop: (lineNo) => {
        const view = viewRef.current;
        if (!view) return null;
        const doc = view.state.doc;
        const n = Math.max(1, Math.min(lineNo, doc.lines));
        const coords = view.coordsAtPos(doc.line(n).from);
        return coords?.top ?? null;
      },
      focus: () => viewRef.current?.focus(),
      openDocument: (id, text) => {
        const state = makeState(text);
        statesRef.current.set(id, state);
        scrollsRef.current.set(id, { x: 0, y: 0 });
        const view = viewRef.current;
        if (view && activeIdRef.current === id) {
          view.setState(state);
          emitCaret(view.state);
          docVersionRef.current += 1;
          callbacksRef.current.onDocVersion(docVersionRef.current);
        }
      },
      closeDocument: (id) => {
        statesRef.current.delete(id);
        scrollsRef.current.delete(id);
      },
      switchDocument: (id) => {
        const view = viewRef.current;
        if (!view) return;
        const prevId = activeIdRef.current;
        if (prevId === id) return;
        saveScroll(prevId);
        statesRef.current.set(prevId, view.state);
        let next = statesRef.current.get(id);
        if (!next) {
          next = makeState("");
          statesRef.current.set(id, next);
        }
        activeIdRef.current = id;
        view.setState(next);
        view.dispatch({
          effects: wrapCompartment.current.reconfigure(
            wrapRef.current ? EditorView.lineWrapping : [],
          ),
        });
        statesRef.current.set(id, view.state);
        requestAnimationFrame(() => restoreScroll(id));
        emitCaret(view.state);
      },
      hasDocument: (id) => statesRef.current.has(id),
    }));

    return <div className="cm-host" ref={hostRef} />;
  },
);

export default CodeEditor;
