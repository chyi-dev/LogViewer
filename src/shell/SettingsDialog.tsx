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
import { IconMoon, IconSun, IconSunMoon, IconX } from "./icons";
import { isTauri } from "./platform";

type SettingsTab = "appearance" | "editor" | "mcp" | "about";

const TABS: { id: SettingsTab; label: string; fields: string[] }[] = [
  {
    id: "appearance",
    label: "外观",
    fields: ["主题", "亮色", "暗色", "跟随系统", "配色", "自定义", "圆角", "珍珠", "薄雾", "石墨", "钴蓝"],
  },
  { id: "editor", label: "编辑", fields: ["字号", "字体", "自动换行"] },
  { id: "mcp", label: "MCP", fields: ["stdio", "路径", "Cursor", "VS Code", "Claude", "工具", "规则包"] },
  { id: "about", label: "关于", fields: ["版本", "赞赏"] },
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
  onClose: () => void;
  appearance: AppearanceApi;
  fontSize: number;
  wrap: boolean;
  onBumpFont: (delta: number) => void;
  onResetFont: () => void;
  onToggleWrap: () => void;
  onAppreciate: () => void;
}

export default function SettingsDialog({
  open,
  onClose,
  appearance,
  fontSize,
  wrap,
  onBumpFont,
  onResetFont,
  onToggleWrap,
  onAppreciate,
}: SettingsDialogProps) {
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<SettingsTab>("appearance");
  const [query, setQuery] = useState("");

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKey);
    };
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
            ref={searchRef}
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
            {tab === "appearance" ? <AppearancePanel appearance={appearance} /> : null}
            {tab === "editor" ? (
              <EditorPanel fontSize={fontSize} wrap={wrap} onBumpFont={onBumpFont} onResetFont={onResetFont} onToggleWrap={onToggleWrap} />
            ) : null}
            {tab === "mcp" ? <McpPanel /> : null}
            {tab === "about" ? (
              <AboutPanel
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

function AppearancePanel({ appearance }: { appearance: AppearanceApi }) {
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
    </div>
  );
}

function EditorPanel({
  fontSize,
  wrap,
  onBumpFont,
  onResetFont,
  onToggleWrap,
}: {
  fontSize: number;
  wrap: boolean;
  onBumpFont: (delta: number) => void;
  onResetFont: () => void;
  onToggleWrap: () => void;
}) {
  return (
    <div className="settings-panel">
      <section className="settings-group">
        <h3>字号</h3>
        <div className="settings-item">
          <div>
            <strong>{fontSize}px</strong>
            <p>日志编辑器使用 IBM Plex Mono。</p>
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
      </section>
      <section className="settings-group">
        <h3>换行</h3>
        <div className="settings-item">
          <div>
            <strong>自动换行</strong>
            <p>{wrap ? "长行会在编辑器宽度内折行。" : "长行保持单行，可横向滚动。"}</p>
          </div>
          <button type="button" className={`choice-btn${wrap ? " selected" : ""}`} aria-pressed={wrap} onClick={onToggleWrap}>
            {wrap ? "已开启" : "已关闭"}
          </button>
        </div>
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

function AboutPanel({ onAppreciate }: { onAppreciate: () => void }) {
  return (
    <div className="settings-panel">
      <section className="settings-group">
        <h3>LogViewer</h3>
        <p className="settings-note">版本 0.1.0。用来阅读日志，并按规则包解析帧。</p>
        <button type="button" className="choice-btn" onClick={onAppreciate}>
          赞赏作者
        </button>
      </section>
    </div>
  );
}
