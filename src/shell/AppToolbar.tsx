import { useEffect, useRef, useState, type ReactNode } from "react";
import type { RuleSummary } from "../types";
import { nextThemeMode, themeModeLabel, type AppThemeMode } from "../theme/appTheme";
import {
  IconClock,
  IconCloseTab,
  IconExport,
  IconFilePlus,
  IconFolderOpen,
  IconGoto,
  IconImport,
  IconLock,
  IconMoon,
  IconMore,
  IconPanel,
  IconRedo,
  IconReplace,
  IconSave,
  IconSaveAs,
  IconSearch,
  IconSelectAll,
  IconSettings,
  IconSun,
  IconSunMoon,
  IconUndo,
  IconUnlock,
} from "./icons";
import { isMac, isTauri, modLabel } from "./platform";
import type { ShortcutId, ToolbarVisibility } from "./prefs";
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
  onExportRules: () => void;
  onImportRules: () => void;
  onEncryptRules: () => void;
  onDecryptRules: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectAll: () => void;
  onInsertDateTime: () => void;
  onSwitchRule: (id: string) => void;
  onOpenSettings: (section?: "rules") => void;
  onCycleTheme: (mode: AppThemeMode) => void;
}

interface AppToolbarProps extends ToolbarActions {
  parseOpen: boolean;
  themeMode: AppThemeMode;
  ruleName: string;
  rules: RuleSummary[];
  toolbar: ToolbarVisibility;
  shortcutLabel: (id: ShortcutId) => string;
  onToast: (message: string) => void;
}

type MenuEntry =
  | { sep: true }
  | { label: string; accel?: string; icon: ReactNode; act: () => void };

export default function AppToolbar(props: AppToolbarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setNarrow(el.clientWidth < 840));
    observer.observe(el);
    setNarrow(el.clientWidth < 840);
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

  const accel = props.shortcutLabel;
  const ThemeIcon = props.themeMode === "system" ? IconSunMoon : props.themeMode === "dark" ? IconMoon : IconSun;
  const hidden: MenuEntry[] = [
    ...(!props.toolbar.newFile ? [{ label: "新建", icon: <IconFilePlus />, accel: accel("new"), act: props.onNew } satisfies MenuEntry] : []),
    ...(!props.toolbar.open ? [{ label: "打开…", icon: <IconFolderOpen />, accel: accel("open"), act: props.onOpen } satisfies MenuEntry] : []),
    ...(!props.toolbar.save ? [{ label: "保存", icon: <IconSave />, accel: accel("save"), act: props.onSave } satisfies MenuEntry] : []),
    ...(!props.toolbar.parse ? [{ label: "解析分栏", icon: <IconPanel />, accel: accel("parse"), act: props.onToggleParse } satisfies MenuEntry] : []),
    ...(!props.toolbar.find || narrow ? [{ label: "查找…", icon: <IconSearch />, accel: accel("find"), act: props.onFind } satisfies MenuEntry] : []),
    ...(!props.toolbar.theme ? [{ label: "切换主题", icon: <ThemeIcon />, act: cycleTheme } satisfies MenuEntry] : []),
  ];

  const moreItems: MenuEntry[] = [
    ...hidden,
    ...(hidden.length ? [{ sep: true } satisfies MenuEntry] : []),
    { label: "替换…", icon: <IconReplace />, accel: accel("replace"), act: props.onReplace },
    { label: "转到…", icon: <IconGoto />, accel: accel("goto"), act: props.onGoto },
    { sep: true },
    { label: "撤销", icon: <IconUndo />, accel: `${modLabel}+Z`, act: props.onUndo },
    { label: "重做", icon: <IconRedo />, accel: `${modLabel}+Y`, act: props.onRedo },
    { label: "全选", icon: <IconSelectAll />, accel: `${modLabel}+A`, act: props.onSelectAll },
    { label: "时间/日期", icon: <IconClock />, accel: accel("insertDate"), act: props.onInsertDateTime },
    { sep: true },
    { label: "另存为…", icon: <IconSaveAs />, accel: accel("saveAs"), act: props.onSaveAs },
    { label: "关闭当前标签", icon: <IconCloseTab />, accel: accel("closeTab"), act: props.onCloseTab },
    { sep: true },
    { label: "导出规则…", icon: <IconExport />, act: props.onExportRules },
    { label: "导入规则…", icon: <IconImport />, act: props.onImportRules },
    { label: "加密规则…", icon: <IconLock />, act: props.onEncryptRules },
    { label: "解密规则…", icon: <IconUnlock />, act: props.onDecryptRules },
  ];

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
        {props.toolbar.newFile ? (
          <button type="button" className="toolbtn" onClick={props.onNew} title={`新建 (${accel("new")})`}>
            <IconFilePlus />
            <span>新建</span>
          </button>
        ) : null}
        {props.toolbar.open ? (
          <button type="button" className="toolbtn" onClick={props.onOpen} title={`打开 (${accel("open")})`}>
            <IconFolderOpen />
            <span>打开</span>
          </button>
        ) : null}
        {props.toolbar.save ? (
          <button type="button" className="toolbtn" onClick={props.onSave} title={`保存 (${accel("save")})`}>
            <IconSave />
            <span>保存</span>
          </button>
        ) : null}
        {props.toolbar.parse ? (
          <button
            type="button"
            className={`toolbtn${props.parseOpen ? " on" : ""}`}
            onClick={props.onToggleParse}
            title={`解析分栏 (${accel("parse")})`}
            aria-pressed={props.parseOpen}
          >
            <IconPanel />
            <span>解析</span>
          </button>
        ) : null}
        <div className={`menu${moreOpen ? " open" : ""}`}>
          <button
            type="button"
            className="toolbtn"
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
            <span>更多</span>
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
                    {item.icon}
                    {item.label}
                    {item.accel ? <span className="accel">{item.accel}</span> : null}
                  </button>
                ),
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className="toolbar-side toolbar-right">
        {props.toolbar.find && !narrow ? (
          <>
            <button type="button" className="toolbtn" onClick={props.onFind} title={`查找 (${accel("find")})`}>
              <IconSearch />
              <span>查找</span>
            </button>
            <button type="button" className="toolbtn" onClick={props.onReplace} title={`替换 (${accel("replace")})`}>
              <IconReplace />
              <span>替换</span>
            </button>
          </>
        ) : null}
        {props.toolbar.rules ? (
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
                  props.onOpenSettings("rules");
                }}
              >
                管理规则…
              </button>
            </div>
          ) : null}
        </div>
        ) : null}
        {props.toolbar.theme ? (
          <button
            type="button"
            className="toolbtn icon-only theme-btn"
            title={`主题：${themeModeLabel(props.themeMode)}`}
            aria-label={`主题：${themeModeLabel(props.themeMode)}`}
            onClick={cycleTheme}
          >
            <ThemeIcon className="theme-icon" />
          </button>
        ) : null}
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
        <WindowControls />
      </div>
    </header>
  );
}
