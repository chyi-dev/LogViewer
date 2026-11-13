import { useEffect, useState } from "react";
import { IconMinus, IconRestore, IconSquare, IconX } from "./icons";
import { isMac, isTauri } from "./platform";

export function shouldShowWindowControls(): boolean {
  return isTauri() && !isMac;
}

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!shouldShowWindowControls()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      if (!cancelled) setMaximized(await win.isMaximized());
      unlisten = await win.onResized(() => {
        void win.isMaximized().then(setMaximized);
      });
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (!shouldShowWindowControls()) return null;

  const run = (action: "minimize" | "toggleMaximize" | "close") => {
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      if (action === "minimize") await win.minimize();
      else if (action === "toggleMaximize") {
        await win.toggleMaximize();
        setMaximized(await win.isMaximized());
      } else await win.close();
    })();
  };

  return (
    <div className="window-controls">
      <button type="button" className="window-btn" title="最小化" aria-label="最小化" onClick={() => run("minimize")}>
        <IconMinus />
      </button>
      <button
        type="button"
        className="window-btn"
        title={maximized ? "还原" : "最大化"}
        aria-label={maximized ? "还原" : "最大化"}
        onClick={() => run("toggleMaximize")}
      >
        {maximized ? <IconRestore /> : <IconSquare />}
      </button>
      <button type="button" className="window-btn window-btn-close" title="隐藏到通知区域" aria-label="隐藏到通知区域" onClick={() => run("close")}>
        <IconX />
      </button>
    </div>
  );
}

export async function toggleWindowMaximize() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().toggleMaximize();
}
