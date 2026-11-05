# LogViewer

跨平台日志阅读与解析桌面应用（`com.chyi.log.viewer`）。

## 环境

- Node 22+ / pnpm
- Rust stable MSVC（Windows：`rustup default stable-x86_64-pc-windows-msvc`）
- WebView2、Visual Studio C++ 桌面工具集

## 开发

```powershell
pnpm install
pnpm tauri dev
```

## 测试

```powershell
cd src-tauri
cargo test
```

## 打包（Windows NSIS）

```powershell
pnpm tauri build
```

macOS / Linux 需在对应系统上构建。
