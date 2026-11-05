import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FIND_RESULT_LIMIT,
  currentMatchIndex,
  findAll,
  findNext,
  findPrev,
  replaceAll as engineReplaceAll,
  replaceOne as engineReplaceOne,
  type FindOptions,
  type MatchHit,
} from "../editor/findEngine";

export interface FindReplaceDialogProps {
  mode: "find" | "replace";
  open: boolean;
  /** Bumps when the active document changes so matches refresh without passing full text. */
  docVersion: number;
  getText: () => string;
  selStart: number;
  selEnd: number;
  getSelection: () => { start: number; end: number };
  onSelect: (start: number, end: number) => void;
  onReplaceText: (next: string, caret: number) => void;
  onFindAllResults: (matches: MatchHit[], query: string) => void;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export interface FindReplaceHandle {
  findNext: () => void;
  findPrev: () => void;
}

const MIN_W = 360;
const MIN_H = 220;

const FindReplaceDialog = forwardRef<FindReplaceHandle, FindReplaceDialogProps>(
  function FindReplaceDialog(
    {
      mode,
      open,
      docVersion,
      getText,
      selStart,
      selEnd,
      getSelection,
      onSelect,
      onReplaceText,
      onFindAllResults,
      onClose,
      onToast,
    },
    ref,
  ) {
    const [findWhat, setFindWhat] = useState("");
    const [replaceWith, setReplaceWith] = useState("");
    const [matchCase, setMatchCase] = useState(false);
    const [useRegex, setUseRegex] = useState(false);
    const [wrap, setWrap] = useState(true);
    const [pos, setPos] = useState({ x: -1, y: 86 });
    const [size, setSize] = useState({ w: 420, h: 280 });
    const [dragging, setDragging] = useState(false);
    const [resizing, setResizing] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const resizeStart = useRef({ x: 0, y: 0, w: 420, h: 280 });
    const panelRef = useRef<HTMLDivElement>(null);
    const findInputRef = useRef<HTMLInputElement>(null);

    const opts: FindOptions = useMemo(
      () => ({ needle: findWhat, matchCase, regex: useRegex }),
      [findWhat, matchCase, useRegex],
    );

    const { matches, error, truncated } = useMemo(() => {
      if (!open || !findWhat) return { matches: [] as MatchHit[] };
      return findAll(getText(), opts, FIND_RESULT_LIMIT);
      // getText is stable via ref; docVersion forces refresh after edits
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, findWhat, opts, docVersion]);

    const currentIdx = currentMatchIndex(matches, selStart, selEnd);

    useEffect(() => {
      if (!open) return;
      requestAnimationFrame(() => {
        findInputRef.current?.focus();
        findInputRef.current?.select();
      });
      if (pos.x < 0 && panelRef.current) {
        const parent = panelRef.current.offsetParent as HTMLElement | null;
        const pw = parent?.clientWidth ?? window.innerWidth;
        const w = size.w;
        setPos({ x: Math.max(20, pw - w - 20), y: 86 });
      }
    }, [open, mode]);

    useEffect(() => {
      if (!dragging) return;
      const onMove = (ev: MouseEvent) => {
        const parent = panelRef.current?.offsetParent as HTMLElement | null;
        const pw = parent?.clientWidth ?? window.innerWidth;
        const ph = parent?.clientHeight ?? window.innerHeight;
        let x = ev.clientX - dragOffset.current.x;
        let y = ev.clientY - dragOffset.current.y;
        x = Math.min(Math.max(0, x), Math.max(0, pw - size.w));
        y = Math.min(Math.max(0, y), Math.max(0, ph - size.h));
        setPos({ x, y });
      };
      const onUp = () => setDragging(false);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
    }, [dragging, size.w, size.h]);

    useEffect(() => {
      if (!resizing) return;
      const onMove = (ev: MouseEvent) => {
        const parent = panelRef.current?.offsetParent as HTMLElement | null;
        const pw = parent?.clientWidth ?? window.innerWidth;
        const ph = parent?.clientHeight ?? window.innerHeight;
        const dw = ev.clientX - resizeStart.current.x;
        const dh = ev.clientY - resizeStart.current.y;
        const maxW = Math.max(MIN_W, pw - Math.max(0, pos.x));
        const maxH = Math.max(MIN_H, ph - Math.max(0, pos.y));
        setSize({
          w: Math.min(maxW, Math.max(MIN_W, resizeStart.current.w + dw)),
          h: Math.min(maxH, Math.max(MIN_H, resizeStart.current.h + dh)),
        });
      };
      const onUp = () => setResizing(false);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
    }, [resizing, pos.x, pos.y]);

    const selectHit = (hit: MatchHit) => {
      onSelect(hit.index, hit.index + hit.length);
    };

    const doFindNext = () => {
      if (error) {
        onToast(error);
        return;
      }
      if (!findWhat) {
        onToast("请输入查找内容");
        return;
      }
      const text = getText();
      const { end } = getSelection();
      const res = findNext(text, opts, end, wrap);
      if (res.error) {
        onToast(res.error);
        return;
      }
      if (!res.hit) {
        onToast(`找不到 "${findWhat}"`);
        return;
      }
      selectHit(res.hit);
    };

    const doFindPrev = () => {
      if (error) {
        onToast(error);
        return;
      }
      if (!findWhat) {
        onToast("请输入查找内容");
        return;
      }
      const text = getText();
      const { start } = getSelection();
      const res = findPrev(text, opts, start, wrap);
      if (res.error) {
        onToast(res.error);
        return;
      }
      if (!res.hit) {
        onToast(`找不到 "${findWhat}"`);
        return;
      }
      selectHit(res.hit);
    };

    useImperativeHandle(
      ref,
      () => ({
        findNext: doFindNext,
        findPrev: doFindPrev,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [opts, wrap, findWhat, error, docVersion],
    );

    const doReplace = () => {
      if (error) {
        onToast(error);
        return;
      }
      const text = getText();
      const { start, end } = getSelection();
      const result = engineReplaceOne(text, opts, replaceWith, start, end);
      if (result.error) {
        onToast(result.error);
        return;
      }
      if (result.replaced) {
        onReplaceText(result.text, result.nextCaret);
        requestAnimationFrame(() => {
          const res = findNext(result.text, opts, result.nextCaret, wrap);
          if (res.hit) selectHit(res.hit);
        });
      } else {
        doFindNext();
      }
    };

    const doReplaceAll = () => {
      if (error) {
        onToast(error);
        return;
      }
      const result = engineReplaceAll(getText(), opts, replaceWith);
      if (result.error) {
        onToast(result.error);
        return;
      }
      onReplaceText(result.text, 0);
      onToast(`已完成全部替换，共替换 ${result.count} 处。`);
    };

    const countLabel = (() => {
      if (error) return error;
      if (!findWhat) return "";
      if (!matches.length) return "无匹配";
      const n = currentIdx >= 0 ? currentIdx + 1 : 0;
      const total = truncated
        ? `${FIND_RESULT_LIMIT}+`
        : String(matches.length);
      if (n === 0) return `共 ${total} 项`;
      return `第 ${n} 项，共 ${total} 项`;
    })();

    if (!open) return null;

    return (
      <div
        ref={panelRef}
        className="find-panel show"
        style={{
          left: pos.x < 0 ? undefined : pos.x,
          top: pos.y,
          right: pos.x < 0 ? 20 : "auto",
          width: size.w,
          height: size.h,
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            doFindNext();
          } else if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            doFindPrev();
          }
        }}
      >
        <div
          className="find-panel-title"
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            const rect = panelRef.current?.getBoundingClientRect();
            if (!rect) return;
            dragOffset.current = {
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
            };
            setDragging(true);
            e.preventDefault();
          }}
        >
          <h2>{mode === "replace" ? "替换" : "查找"}</h2>
          <button
            type="button"
            className="find-panel-close"
            onClick={onClose}
            title="关闭"
          >
            ×
          </button>
        </div>

        <div className="find-panel-body">
          <div className="row">
            <label htmlFor="find-what">{mode === "replace" ? "查找" : "内容"}</label>
            <input
              id="find-what"
              type="text"
              ref={findInputRef}
              value={findWhat}
              onChange={(e) => setFindWhat(e.target.value)}
            />
          </div>
          {mode === "replace" ? (
            <div className="row">
              <label htmlFor="replace-with">替换为</label>
              <input
                id="replace-with"
                type="text"
                value={replaceWith}
                onChange={(e) => setReplaceWith(e.target.value)}
              />
            </div>
          ) : null}

          <div className="opts find-opts">
            <label className="check-line">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={(e) => setMatchCase(e.target.checked)}
              />
              <span>区分大小写</span>
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                checked={useRegex}
                onChange={(e) => setUseRegex(e.target.checked)}
              />
              <span>使用正则表达式</span>
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                checked={wrap}
                onChange={(e) => setWrap(e.target.checked)}
              />
              <span>环绕搜索</span>
            </label>
          </div>

          <div className={`find-count${error ? " err" : ""}`}>{countLabel}</div>

          <div className="actions find-actions">
            <button type="button" className="primary" onClick={doFindNext}>
              查找下一个
            </button>
            <button type="button" onClick={doFindPrev}>
              查找上一个
            </button>
            <button
              type="button"
              onClick={() => {
                if (error) {
                  onToast(error);
                  return;
                }
                if (!findWhat) {
                  onToast("请输入查找内容");
                  return;
                }
                if (!matches.length) {
                  onToast(`找不到 "${findWhat}"`);
                  return;
                }
                if (truncated) {
                  const ok = window.confirm(
                    `单次最多查出${FIND_RESULT_LIMIT}条，确认后显示${FIND_RESULT_LIMIT}条`,
                  );
                  if (!ok) return;
                }
                onFindAllResults(
                  matches.slice(0, FIND_RESULT_LIMIT),
                  findWhat,
                );
              }}
            >
              查找全部
            </button>
            {mode === "replace" ? (
              <>
                <button type="button" onClick={doReplace}>
                  替换
                </button>
                <button type="button" onClick={doReplaceAll}>
                  全部替换
                </button>
              </>
            ) : null}
            <button type="button" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        <div
          className="find-panel-resize"
          title="拖动调整大小"
          onMouseDown={(e) => {
            resizeStart.current = {
              x: e.clientX,
              y: e.clientY,
              w: size.w,
              h: size.h,
            };
            setResizing(true);
            e.preventDefault();
            e.stopPropagation();
          }}
        />
      </div>
    );
  },
);

export default FindReplaceDialog;
