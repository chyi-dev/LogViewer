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

## 打包（macOS DMG）

在 macOS 上构建。产物是当前架构的磁盘映像（这台 Intel Mac 为 x64），使用临时签名，未做 Apple 公证。

```sh
pnpm tauri build
```

产物：

- `src-tauri/target/release/bundle/dmg/LogViewer_0.1.0_x64.dmg`
- `src-tauri/target/release/bundle/macos/LogViewer.app`

Linux 需在对应系统上构建。
