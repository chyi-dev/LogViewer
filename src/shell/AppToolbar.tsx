import { useEffect, useRef, useState } from "react";
import type { RuleSummary } from "../types";
import { nextThemeMode, themeModeLabel, type AppThemeMode } from "../theme/appTheme";
import {
  IconFilePlus,
  IconFolderOpen,
  IconMoon,
  IconMore,
  IconPanel,
  IconSave,
  IconSearch,
  IconSettings,
  IconSun,
  IconSunMoon,
} from "./icons";
import { isMac, isTauri, modLabel } from "./platform";
import { toggleWindowMaximize, WindowControls } from "./WindowControls";

export interface ToolbarActions {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onCloseTab: () => void;
  onFind: () => void;
  onReplace: () => void;
  onGoto: () => void;
  onToggleParse: () => void;
  onToggleWrap: () => void;
  onBumpFont: (delta: number) => void;
  onResetFont: () => void;
  onManageRules: () => void;
  onExportRules: () => void;
  onImportRules: () => void;
  onEncryptRules: () => void;
  onDecryptRules: () => void;
  onAppreciate: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectAll: () => void;
  onInsertDateTime: () => void;
  onSwitchRule: (id: string) => void;
  onOpenSettings: () => void;
  onCycleTheme: (mode: AppThemeMode) => void;
}

interface AppToolbarProps extends ToolbarActions {
  parseOpen: boolean;
  wrap: boolean;
  themeMode: AppThemeMode;
  ruleName: string;
  rules: RuleSummary[];
  onToast: (message: string) => void;
}

type MenuEntry =
  | { sep: true }
  | { label: string; accel?: string; act: () => void };

export default function AppToolbar(props: AppToolbarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setNarrow(el.clientWidth < 760));
    observer.observe(el);
    setNarrow(el.clientWidth < 760);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const close = () => {
      setMoreOpen(false);
      setRuleOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!barRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const cycleTheme = () => {
    const next = nextThemeMode(props.themeMode);
    props.onCycleTheme(next);
    props.onToast(`主题：${themeModeLabel(next)}`);
  };

  const moreItems: MenuEntry[] = [
    ...(narrow ? [{ label: "查找…", accel: `${modLabel}+F`, act: props.onFind } satisfies MenuEntry] : []),
    { label: "替换…", accel: `${modLabel}+H`, act: props.onReplace },
    { label: "转到…", accel: `${modLabel}+G`, act: props.onGoto },
    { sep: true },
    { label: "撤销", accel: `${modLabel}+Z`, act: props.onUndo },
    { label: "重做", accel: `${modLabel}+Y`, act: props.onRedo },
    { label: "全选", accel: `${modLabel}+A`, act: props.onSelectAll },
    { label: "时间/日期", accel: "F5", act: props.onInsertDateTime },
    { sep: true },
    { label: "另存为…", accel: `${modLabel}+Shift+S`, act: props.onSaveAs },
    { label: "关闭当前标签", accel: `${modLabel}+W`, act: props.onCloseTab },
    { sep: true },
    { label: props.wrap ? "关闭自动换行" : "自动换行", act: props.onToggleWrap },
    { label: "增大字体", accel: `${modLabel}+=`, act: () => props.onBumpFont(1) },
    { label: "减小字体", accel: `${modLabel}+-`, act: () => props.onBumpFont(-1) },
    { label: "默认字号", accel: `${modLabel}+0`, act: props.onResetFont },
    { sep: true },
    { label: "管理规则…", act: props.onManageRules },
    { label: "导出规则…", act: props.onExportRules },
    { label: "导入规则…", act: props.onImportRules },
    { label: "加密规则…", act: props.onEncryptRules },
    { label: "解密规则…", act: props.onDecryptRules },
    { sep: true },
    { label: "赞赏作者…", act: props.onAppreciate },
  ];

  const ThemeIcon = props.themeMode === "system" ? IconSunMoon : props.themeMode === "dark" ? IconMoon : IconSun;
  const reserveInset = isMac && isTauri();

  const onDragDoubleClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, [role='button']")) return;
    void toggleWindowMaximize();
  };

  return (
    <header
      ref={barRef}
      className="toolbar"
      style={reserveInset ? { paddingLeft: 78 } : undefined}
      onDoubleClick={onDragDoubleClick}
    >
      <div className="toolbar-drag" data-tauri-drag-region />
      <div className="toolbar-side toolbar-left">
        <span className="brand">LogViewer</span>
        <button type="button" className="toolbtn" onClick={props.onNew} title={`新建 (${modLabel}+N)`}>
          <IconFilePlus />
          <span>新建</span>
        </button>
        <button type="button" className="toolbtn" onClick={props.onOpen} title={`打开 (${modLabel}+O)`}>
          <IconFolderOpen />
          <span>打开</span>
        </button>
        <button type="button" className="toolbtn" onClick={props.onSave} title={`保存 (${modLabel}+S)`}>
          <IconSave />
          <span>保存</span>
        </button>
        <button
          type="button"
          className={`toolbtn${props.parseOpen ? " on" : ""}`}
          onClick={props.onToggleParse}
          title={`解析分栏 (${modLabel}+Shift+P)`}
          aria-pressed={props.parseOpen}
        >
          <IconPanel />
          <span>解析</span>
        </button>
      </div>
      <div className="toolbar-side toolbar-right">
        {narrow ? null : (
          <button type="button" className="toolbtn" onClick={props.onFind} title={`查找 (${modLabel}+F)`}>
            <IconSearch />
            <span>查找</span>
          </button>
        )}
        <div className={`rule-chip-wrap${ruleOpen ? " open" : ""}`}>
          <button
            type="button"
            className="chip rule-chip"
            aria-expanded={ruleOpen}
            title="切换解析规则"
            onClick={(event) => {
              event.stopPropagation();
              setMoreOpen(false);
              setRuleOpen((open) => !open);
            }}
          >
            规则 <strong>{props.ruleName}</strong>
          </button>
          {ruleOpen ? (
            <div className="dropdown rule-dropdown" role="menu">
              {props.rules.length === 0 ? (
                <div className="menu-empty">暂无规则</div>
              ) : (
                props.rules.map((rule) => (
                  <button
                    type="button"
                    key={rule.id}
                    onClick={() => {
                      setRuleOpen(false);
                      props.onSwitchRule(rule.id);
                    }}
                  >
                    {rule.active ? <span className="menu-current" /> : <span className="menu-current spacer" />}
                    {rule.name}
                  </button>
                ))
              )}
              <div className="sep" />
              <button
                type="button"
                onClick={() => {
                  setRuleOpen(false);
                  props.onManageRules();
                }}
              >
                管理规则…
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="toolbtn icon-only theme-btn"
          title={`主题：${themeModeLabel(props.themeMode)}`}
          aria-label={`主题：${themeModeLabel(props.themeMode)}`}
          onClick={cycleTheme}
        >
          <ThemeIcon className="theme-icon" />
        </button>
        <button
          type="button"
          className="toolbtn icon-only"
          title="设置"
          aria-label="设置"
          onClick={() => {
            setMoreOpen(false);
            setRuleOpen(false);
            props.onOpenSettings();
          }}
        >
          <IconSettings />
        </button>
        <div className={`menu${moreOpen ? " open" : ""}`}>
          <button
            type="button"
            className="toolbtn icon-only"
            title="更多"
            aria-label="更多"
            aria-expanded={moreOpen}
            onClick={(event) => {
              event.stopPropagation();
              setRuleOpen(false);
              setMoreOpen((open) => !open);
            }}
          >
            <IconMore />
          </button>
          {moreOpen ? (
            <div className="dropdown more-dropdown" role="menu">
              {moreItems.map((item, index) =>
                "sep" in item ? (
                  <div className="sep" key={`sep-${index}`} />
                ) : (
                  <button
                    type="button"
                    key={item.label}
                    onClick={() => {
                      setMoreOpen(false);
                      item.act();
                    }}
                  >
                    {item.label}
                    {item.accel ? <span className="accel">{item.accel}</span> : null}
                  </button>
                ),
              )}
            </div>
          ) : null}
        </div>
        <WindowControls />
      </div>
    </header>
  );
}
