import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  APP_CUSTOM_UI_COLOR_DEFS,
  APP_THEME_PALETTES,
  themeModeLabel,
  type AppCornerStyle,
  type AppThemeMode,
} from "../theme/appTheme";
import type { AppearanceApi } from "../theme/useAppearance";
import type { RuleSummary } from "../types";
import { IconMoon, IconSun, IconSunMoon, IconX } from "./icons";
import { isTauri } from "./platform";
import {
  exportSettingsBundle,
  formatShortcut,
  normalizeKey,
  parseSettingsBundle,
  SHORTCUT_DEFS,
  stepScale,
  TOOLBAR_TOGGLES,
  type CloseUnsaved,
  type EditorFont,
  type PrefsApi,
  type SettingsBundle,
  type ShortcutChord,
  type ShortcutId,
  type TabLayout,
  type TabMaxWidth,
} from "./prefs";

export type SettingsSection = "appearance" | "editor" | "rules" | "shortcuts" | "mcp" | "about";

const TABS: { id: SettingsSection; label: string; fields: string[] }[] = [
  {
    id: "appearance",
    label: "外观",
    fields: ["主题", "亮色", "暗色", "跟随系统", "配色", "自定义", "圆角", "缩放", "标签", "顶栏", "置顶"],
  },
  { id: "editor", label: "编辑", fields: ["字号", "字体", "自动换行", "行号", "空白", "关闭"] },
  { id: "rules", label: "规则", fields: ["规则", "删除", "版本", "当前"] },
  { id: "shortcuts", label: "快捷键", fields: ["新建", "保存", "查找", "字号", "解析"] },
  { id: "mcp", label: "MCP", fields: ["stdio", "路径", "Cursor", "VS Code", "Claude", "工具", "规则包"] },
  { id: "about", label: "关于", fields: ["版本", "赞赏", "导出", "导入"] },
];

const THEME_OPTIONS: { value: AppThemeMode; label: string; icon: typeof IconSun }[] = [
  { value: "light", label: "亮色", icon: IconSun },
  { value: "dark", label: "暗色", icon: IconMoon },
  { value: "system", label: "跟随系统", icon: IconSunMoon },
];

const CORNER_OPTIONS: { value: AppCornerStyle; label: string }[] = [
  { value: "none", label: "无" },
  { value: "small", label: "小" },
  { value: "large", label: "大" },
];

const MCP_CLIENTS = [
  { id: "cursor", label: "Cursor" },
  { id: "vscode", label: "VS Code" },
  { id: "claude", label: "Claude Code" },
] as const;

interface SettingsDialogProps {
  open: boolean;
  section: SettingsSection;
  onClose: () => void;
  appearance: AppearanceApi;
  prefs: PrefsApi;
  fontSize: number;
  rules: RuleSummary[];
  onDeleteRule: (id: string) => void;
  onBumpFont: (delta: number) => void;
  onResetFont: () => void;
  onImportSettings: (bundle: SettingsBundle) => void;
  onAppreciate: () => void;
}

export default function SettingsDialog({
  open,
  section,
  onClose,
  appearance,
  prefs,
  fontSize,
  rules,
  onDeleteRule,
  onBumpFont,
  onResetFont,
  onImportSettings,
  onAppreciate,
}: SettingsDialogProps) {
  const titleId = useId();
  const [tab, setTab] = useState<SettingsSection>(section);
  const [query, setQuery] = useState("");

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setTab(section);
  }, [open, section]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const visibleTabs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TABS;
    return TABS.filter(
      (item) =>
        item.label.toLowerCase().includes(q) || item.fields.some((field) => field.toLowerCase().includes(q)),
    );
  }, [query]);

  useEffect(() => {
    if (!visibleTabs.some((item) => item.id === tab)) {
      const next = visibleTabs[0];
      if (next) setTab(next.id);
    }
  }, [visibleTabs, tab]);

  if (!open) return null;

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-head">
          <h2 id={titleId}>设置</h2>
          <input
            className="settings-search"
            value={query}
            placeholder="搜索设置"
            aria-label="搜索设置"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="settings-close" aria-label="关闭设置" onClick={onClose}>
            <IconX />
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav" aria-label="设置分类">
            {visibleTabs.length === 0 ? (
              <p className="settings-empty">没有匹配的设置</p>
            ) : (
              visibleTabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-btn${item.id === tab ? " active" : ""}`}
                  aria-current={item.id === tab ? "page" : undefined}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))
            )}
          </nav>
          <div className="settings-body">
            {tab === "appearance" ? <AppearancePanel appearance={appearance} prefs={prefs} /> : null}
            {tab === "editor" ? (
              <EditorPanel prefs={prefs} fontSize={fontSize} onBumpFont={onBumpFont} onResetFont={onResetFont} />
            ) : null}
            {tab === "rules" ? <RulesPanel rules={rules} onDelete={onDeleteRule} /> : null}
            {tab === "shortcuts" ? <ShortcutsPanel prefs={prefs} /> : null}
            {tab === "mcp" ? <McpPanel /> : null}
            {tab === "about" ? (
              <AboutPanel
                appearance={appearance}
                prefs={prefs}
                fontSize={fontSize}
                onImportSettings={onImportSettings}
                onAppreciate={() => {
                  onClose();
                  onAppreciate();
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function AppearancePanel({ appearance, prefs }: { appearance: AppearanceApi; prefs: PrefsApi }) {
  const { state, setMode, setPalette, setCorner, setCustomColor, resetCustomColors, setPreviewPalette, isDark } =
    appearance;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteTriggerRef = useRef<HTMLButtonElement>(null);
  const [paletteBox, setPaletteBox] = useState<{ top: number; left: number; width: number } | null>(null);
  useEffect(() => {
    if (!paletteOpen) return;
    const place = () => {
      const rect = paletteTriggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPaletteBox({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    };
    place();
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".palette-field, .palette-menu")) {
        setPaletteOpen(false);
        setPreviewPalette(null);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", place);
    };
  }, [paletteOpen, setPreviewPalette]);
  const selected = APP_THEME_PALETTES.find((item) => item.value === state.palette) ?? APP_THEME_PALETTES[0];
  const colors = isDark ? state.customDark : state.customLight;

  return (
    <div className="settings-panel">
      <section className="settings-group">
        <h3>主题</h3>
        <div className="choice-row">
          {THEME_OPTIONS.map((option) => {
            const Glyph = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                className={`choice-btn${state.mode === option.value ? " selected" : ""}`}
                aria-pressed={state.mode === option.value}
                onClick={() => setMode(option.value)}
              >
                <Glyph />
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="settings-note">当前为{themeModeLabel(state.mode)}。顶栏上的主题按钮会在这三项之间切换。</p>
      </section>

      <section className="settings-group">
        <div className="settings-group-head">
          <h3>配色</h3>
          {state.palette === "custom" ? (
            <button type="button" className="text-btn" onClick={() => resetCustomColors(isDark)}>
              重置{isDark ? "暗色" : "亮色"}
            </button>
          ) : null}
        </div>
        <div className="palette-field">
          <button
            ref={paletteTriggerRef}
            type="button"
            className="palette-trigger"
            aria-expanded={paletteOpen}
            aria-label="配色"
            onClick={() => setPaletteOpen((open) => !open)}
          >
            <span className="swatch" style={{ background: selected.previewColor }} />
            <span>{selected.label}</span>
          </button>
          {paletteOpen && paletteBox
            ? createPortal(
            <div
              className="palette-menu"
              role="listbox"
              style={{ top: paletteBox.top, left: paletteBox.left, width: paletteBox.width }}
              onMouseLeave={() => setPreviewPalette(null)}
            >
              {APP_THEME_PALETTES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === state.palette}
                  className={option.value === state.palette ? "selected" : undefined}
                  onMouseEnter={() => setPreviewPalette(option.value)}
                  onFocus={() => setPreviewPalette(option.value)}
                  onClick={() => {
                    setPalette(option.value);
                    setPaletteOpen(false);
                  }}
                >
                  <span className="swatch" style={{ background: option.previewColor }} />
                  {option.label}
                </button>
              ))}
            </div>,
            document.body,
          ) : null}
        </div>
        {state.palette === "custom" ? (
          <div className="color-grid">
            {APP_CUSTOM_UI_COLOR_DEFS.map((def) => (
              <label key={def.key} className="color-row">
                <span>{def.label}</span>
                <input
                  type="color"
                  value={colors[def.key]}
                  aria-label={def.label}
                  onChange={(event) => setCustomColor(def.key, event.target.value, isDark)}
                />
                <code className="hex-input">{colors[def.key]}</code>
              </label>
            ))}
          </div>
        ) : null}
      </section>

      <section className="settings-group">
        <h3>圆角</h3>
        <div className="choice-row">
          {CORNER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`choice-btn${state.corner === option.value ? " selected" : ""}`}
              style={{ borderRadius: option.value === "none" ? 0 : option.value === "small" ? 4 : 10 }}
              aria-pressed={state.corner === option.value}
              onClick={() => setCorner(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <h3>界面</h3>
        <div className="settings-item">
          <div>
            <strong>缩放 {Math.round(prefs.prefs.uiScale * 100)}%</strong>
            <p>整体界面按比例放大或缩小，范围 80% 到 150%。</p>
          </div>
          <div className="choice-row">
            <button type="button" className="choice-btn" onClick={() => prefs.patch({ uiScale: stepScale(prefs.prefs.uiScale, -0.1) })}>
              缩小
            </button>
            <button type="button" className="choice-btn" onClick={() => prefs.patch({ uiScale: stepScale(prefs.prefs.uiScale, 0.1) })}>
              放大
            </button>
          </div>
        </div>
        <div className="settings-item">
          <div>
            <strong>标签排列</strong>
            <p>{prefs.prefs.tabLayout === "wrap" ? "放不下时换到下一行。" : "放不下时在一行里横向滚动。"}</p>
          </div>
          <div className="choice-row">
            {([
              ["scroll", "滚动"],
              ["wrap", "换行"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`choice-btn${prefs.prefs.tabLayout === value ? " selected" : ""}`}
                aria-pressed={prefs.prefs.tabLayout === value}
                onClick={() => prefs.patch({ tabLayout: value satisfies TabLayout })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-item">
          <div>
            <strong>标签宽度</strong>
            <p>限制每个标签标题的最大宽度。</p>
          </div>
          <div className="choice-row">
            {([
              ["compact", "紧凑"],
              ["standard", "标准"],
              ["wide", "较宽"],
              ["unlimited", "不限制"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`choice-btn${prefs.prefs.tabMaxWidth === value ? " selected" : ""}`}
                aria-pressed={prefs.prefs.tabMaxWidth === value}
                onClick={() => prefs.patch({ tabMaxWidth: value satisfies TabMaxWidth })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-group">
        <h3>顶栏</h3>
        <div className="choice-row">
          {TOOLBAR_TOGGLES.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`choice-btn${prefs.prefs.toolbar[item.key] ? " selected" : ""}`}
              aria-pressed={prefs.prefs.toolbar[item.key]}
              onClick={() =>
                prefs.patch({
                  toolbar: { ...prefs.prefs.toolbar, [item.key]: !prefs.prefs.toolbar[item.key] },
                })
              }
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="settings-note">隐藏的按钮仍可从「更多」和快捷键使用。设置和「更多」始终保留。</p>
        {isTauri() ? (
          <div className="settings-item">
            <div>
              <strong>窗口置顶</strong>
              <p>{prefs.prefs.alwaysOnTop ? "窗口保持在其他窗口之上。" : "窗口按系统的普通层级显示。"}</p>
            </div>
            <button
              type="button"
              className={`choice-btn${prefs.prefs.alwaysOnTop ? " selected" : ""}`}
              aria-pressed={prefs.prefs.alwaysOnTop}
              onClick={() => prefs.patch({ alwaysOnTop: !prefs.prefs.alwaysOnTop })}
            >
              {prefs.prefs.alwaysOnTop ? "已开启" : "已关闭"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function EditorPanel({
  prefs,
  fontSize,
  onBumpFont,
  onResetFont,
}: {
  prefs: PrefsApi;
  fontSize: number;
  onBumpFont: (delta: number) => void;
  onResetFont: () => void;
}) {
  const font = prefs.prefs.editorFont;
  const wrap = prefs.prefs.wrap;
  return (
    <div className="settings-panel">
      <section className="settings-group">
        <h3>字号</h3>
        <div className="settings-item">
          <div>
            <strong>{fontSize}px</strong>
            <p>{font === "system" ? "日志使用系统等宽字体。" : "日志使用 IBM Plex Mono。"}</p>
          </div>
          <div className="choice-row">
            <button type="button" className="choice-btn" onClick={() => onBumpFont(-1)}>
              减小
            </button>
            <button type="button" className="choice-btn" onClick={() => onBumpFont(1)}>
              增大
            </button>
            <button type="button" className="choice-btn" onClick={onResetFont}>
              默认
            </button>
          </div>
        </div>
        <div className="settings-item">
          <div>
            <strong>等宽字体</strong>
            <p>只在已安装的字体之间切换。</p>
          </div>
          <div className="choice-row">
            {([
              ["plex", "IBM Plex Mono"],
              ["system", "界面等宽"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`choice-btn${font === value ? " selected" : ""}`}
                aria-pressed={font === value}
                onClick={() => prefs.patch({ editorFont: value satisfies EditorFont })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section className="settings-group">
        <h3>显示</h3>
        <div className="settings-item">
          <div>
            <strong>自动换行</strong>
            <p>{wrap ? "长行会在编辑器宽度内折行。" : "长行保持单行，可横向滚动。"}</p>
          </div>
          <button
            type="button"
            className={`choice-btn${wrap ? " selected" : ""}`}
            aria-pressed={wrap}
            onClick={() => prefs.patch({ wrap: !wrap })}
          >
            {wrap ? "已开启" : "已关闭"}
          </button>
        </div>
        <div className="settings-item">
          <div>
            <strong>行号</strong>
            <p>{prefs.prefs.showLineNumbers ? "左侧显示行号。" : "隐藏行号，腾出横向空间。"}</p>
          </div>
          <button
            type="button"
            className={`choice-btn${prefs.prefs.showLineNumbers ? " selected" : ""}`}
            aria-pressed={prefs.prefs.showLineNumbers}
            onClick={() => prefs.patch({ showLineNumbers: !prefs.prefs.showLineNumbers })}
          >
            {prefs.prefs.showLineNumbers ? "已开启" : "已关闭"}
          </button>
        </div>
        <div className="settings-item">
          <div>
            <strong>空白字符</strong>
            <p>{prefs.prefs.showWhitespace ? "空格和制表符会画出来。" : "空白保持不可见。"}</p>
          </div>
          <button
            type="button"
            className={`choice-btn${prefs.prefs.showWhitespace ? " selected" : ""}`}
            aria-pressed={prefs.prefs.showWhitespace}
            onClick={() => prefs.patch({ showWhitespace: !prefs.prefs.showWhitespace })}
          >
            {prefs.prefs.showWhitespace ? "已开启" : "已关闭"}
          </button>
        </div>
      </section>
      <section className="settings-group">
        <h3>关闭</h3>
        <div className="settings-item">
          <div>
            <strong>未保存的标签</strong>
            <p>{prefs.prefs.closeUnsaved === "ask" ? "关闭前提示未保存的更改。" : "直接关闭，不保留未保存的更改。"}</p>
          </div>
          <div className="choice-row">
            {([
              ["ask", "询问"],
              ["discard", "直接关闭"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`choice-btn${prefs.prefs.closeUnsaved === value ? " selected" : ""}`}
                aria-pressed={prefs.prefs.closeUnsaved === value}
                onClick={() => prefs.patch({ closeUnsaved: value satisfies CloseUnsaved })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function RulesPanel({ rules, onDelete }: { rules: RuleSummary[]; onDelete: (id: string) => void }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="settings-panel">
      <section className="settings-group">
        <h3>规则库</h3>
        <p className="settings-note">当前规则用于解析日志。删除需要再点一次确认。</p>
        <div className="rule-manage-list">
          {rules.length === 0 ? (
            <div className="rule-manage-empty">暂无规则</div>
          ) : (
            rules.map((rule) => (
              <div key={rule.id} className="rule-manage-row">
                <div className="rule-manage-meta">
                  <div className="rule-manage-name">
                    {rule.name}
                    {rule.active ? <span className="rule-manage-badge">当前</span> : null}
                  </div>
                  <div className="rule-manage-ver">v{rule.version}</div>
                </div>
                <button
                  type="button"
                  className={`rule-manage-del${confirmId === rule.id ? " confirm" : ""}`}
                  onClick={() => {
                    if (confirmId === rule.id) {
                      setConfirmId(null);
                      onDelete(rule.id);
                    } else {
                      setConfirmId(rule.id);
                    }
                  }}
                >
                  {confirmId === rule.id ? "确认删除" : "删除"}
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ShortcutsPanel({ prefs }: { prefs: PrefsApi }) {
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        setRecording(null);
        return;
      }
      if (event.key === "Control" || event.key === "Meta" || event.key === "Alt" || event.key === "Shift") return;
      const chord: ShortcutChord = {
        key: normalizeKey(event.key),
        mod: event.metaKey || event.ctrlKey,
        shift: event.shiftKey,
        alt: event.altKey,
      };
      const error = prefs.setShortcut(recording, chord);
      setMessage(error ?? "");
      if (!error) setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [prefs, recording]);

  return (
    <div className="settings-panel">
      <section className="settings-group">
        <div className="settings-group-head">
          <h3>快捷键</h3>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              prefs.resetShortcuts();
              setMessage("");
              setRecording(null);
            }}
          >
            全部恢复默认
          </button>
        </div>
        <p className="settings-note">点某一行后按下新组合键。Esc 取消。撤销和重做仍由编辑器处理。</p>
        <div className="shortcut-list">
          {SHORTCUT_DEFS.map((item) => (
            <div className="shortcut-row" key={item.id}>
              <strong>{item.label}</strong>
              <div className="choice-row">
                <button
                  type="button"
                  className={`choice-btn keycap${recording === item.id ? " recording" : ""}`}
                  onClick={() => {
                    setMessage("");
                    setRecording(item.id);
                  }}
                >
                  {recording === item.id ? "请按键…" : formatShortcut(prefs.prefs.shortcuts[item.id])}
                </button>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    prefs.resetShortcut(item.id);
                    setMessage("");
                    if (recording === item.id) setRecording(null);
                  }}
                >
                  恢复
                </button>
              </div>
            </div>
          ))}
        </div>
        {message ? <p className="shortcut-error">{message}</p> : null}
      </section>
    </div>
  );
}

function mcpConfig(client: (typeof MCP_CLIENTS)[number]["id"], command: string) {
  const server = { command, args: [] as string[] };
  if (client === "vscode") {
    return JSON.stringify({ servers: { "log-viewer-rules": server } }, null, 2);
  }
  return JSON.stringify({ mcpServers: { "log-viewer-rules": server } }, null, 2);
}

function McpPanel() {
  const [path, setPath] = useState("");
  const [client, setClient] = useState<(typeof MCP_CLIENTS)[number]["id"]>("cursor");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isTauri()) {
      setPath("");
      return;
    }
    void invoke<string>("mcp_server_path")
      .then(setPath)
      .catch(() => setPath(""));
  }, []);

  const command = path || "log-viewer-mcp";
  const snippet = mcpConfig(client, command);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
    } catch {
      if (isTauri()) {
        const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
        await writeText(snippet);
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="settings-panel">
      <section className="settings-group">
        <h3>规则包服务</h3>
        <p className="settings-note">
          本地 stdio 进程，供 Cursor 等客户端读取规则包编写说明，并把校验过的规则包加密成 .lvrule。不提供 HTTP 监听。
        </p>
        <div className="settings-item">
          <div>
            <strong>可执行文件</strong>
            <p className="mono-path">{path || (isTauri() ? "未能定位 log-viewer-mcp" : "在桌面应用中显示二进制路径")}</p>
          </div>
          <span className="status-pill">stdio</span>
        </div>
      </section>
      <section className="settings-group">
        <h3>客户端配置</h3>
        <div className="choice-row">
          {MCP_CLIENTS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`choice-btn${client === item.id ? " selected" : ""}`}
              aria-pressed={client === item.id}
              onClick={() => setClient(item.id)}
            >
              {item.label}
            </button>
          ))}
          <button type="button" className="choice-btn" onClick={() => void copy()}>
            {copied ? "已复制" : "复制"}
          </button>
        </div>
        <pre className="config-block">{snippet}</pre>
      </section>
      <section className="settings-group">
        <h3>工具</h3>
        <ul className="tool-list">
          <li>
            <strong>get_rulepack_standard</strong>
            <span>返回规则包编写说明和 JSON Schema。</span>
          </li>
          <li>
            <strong>encrypt_rulepack</strong>
            <span>校验规则包 JSON，再用口令写成 .lvrule，不写入应用规则库。</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

function AboutPanel({
  appearance,
  prefs,
  fontSize,
  onImportSettings,
  onAppreciate,
}: {
  appearance: AppearanceApi;
  prefs: PrefsApi;
  fontSize: number;
  onImportSettings: (bundle: SettingsBundle) => void;
  onAppreciate: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [transferMessage, setTransferMessage] = useState("");

  const exportSettings = () => {
    const json = exportSettingsBundle({
      appearance: appearance.state,
      fontSize,
      prefs: prefs.prefs,
    });
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "logviewer-settings.json";
    link.click();
    URL.revokeObjectURL(url);
    setTransferMessage("已导出外观、编辑器、顶栏和快捷键。");
  };

  const importSettings = async (file: File) => {
    const parsed = parseSettingsBundle(await file.text());
    if ("error" in parsed) {
      setTransferMessage(parsed.error);
      return;
    }
    onImportSettings(parsed);
    setTransferMessage("已导入设置。");
  };

  return (
    <div className="settings-panel">
      <section className="settings-group">
        <h3>LogViewer</h3>
        <p className="settings-note">版本 0.1.0。用来阅读日志，并按规则包解析帧。</p>
        <button type="button" className="choice-btn" onClick={onAppreciate}>
          赞赏作者
        </button>
      </section>
      <section className="settings-group">
        <h3>设置文件</h3>
        <p className="settings-note">导出和导入外观、编辑器偏好、顶栏显隐和快捷键。不包含规则库和打开的文档。</p>
        <div className="choice-row">
          <button type="button" className="choice-btn" onClick={exportSettings}>
            导出
          </button>
          <button type="button" className="choice-btn" onClick={() => fileRef.current?.click()}>
            导入
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importSettings(file);
          }}
        />
        {transferMessage ? <p className="settings-note">{transferMessage}</p> : null}
      </section>
    </div>
  );
}
