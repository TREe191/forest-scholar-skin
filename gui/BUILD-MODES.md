# Build and runtime modes

本文面向项目开发者和发布维护者。项目支持同一源码树下的 Development、Beta 和 Production 三种模式。

## 前提

- 构建平台：Windows x64。
- 开发机需要 Node.js 和 npm。
- 首次准备：

```powershell
cd .\gui
npm install
npm run prepare:node
```

`prepare:node` 下载并校验固定版本的 Windows x64 Node runtime，供打包后的启动与注入流程使用。最终用户不需要安装 Node.js 或 npm。

## Development

启动方式：

```powershell
npm start
```

或在仓库根目录运行：

```powershell
.\Start-ThemeManager.cmd
```

Development 显示 `management.origin=development` 的测试主题，允许 DevTools 和手动 Rescan，并提供 Diagnostics / Support。它从源码项目目录读取资源，适合日常开发和测试。

## Beta

```powershell
npm run start:beta
npm run package:beta
npm run make:beta
```

- `start:beta` 从源码预览 Beta 权限和 UI。
- 打包 Beta 隐藏 development themes，关闭 DevTools，但保留 Diagnostics / Support。
- 打包产物包含固定、校验过的 bundled Node。
- 可写配置、用户主题和 runtime 保存在 Electron userData，不写入安装资源目录。

## Production

```powershell
npm run start:production
npm run package
npm run make
```

- `start:production` 从源码预览 Production 限制。
- Production 隐藏 development themes、DevTools 和 Beta Diagnostics / Support UI，并在主进程拒绝相应诊断导出 IPC。
- 打包后的 mode 来自构建元数据，只允许 `beta` 或 `production`；环境变量不能把已打包应用升级成 Development。

## 打包路径与数据位置

打包应用使用两个明确分离的根目录：

- **Resource Root**：`process.resourcesPath/skin-core`
- **User Data Root**：Electron `app.getPath("userData")`

Resource Root 是只读发行资源闭包，只包含固定 scripts/styles/schema、Forest Scholar、Phainon、默认配置和 bundled Node。它不包含源码 `config/app.json`、用户主题、runtime/history、diagnostics ZIP、Universal Demo 或 Universal Dark Test。

User Data Root 保存可写的 `config/app.json`、用户主题和 runtime。首次启动只在配置不存在时从 `config/default-app.json` 创建默认配置，不覆盖已有用户数据。

## Bundled Node

构建脚本校验预先准备的 `node.exe` 和官方 Node LICENSE 的 SHA-256，然后复制到 `skin-core/node/`，同时写入 runtime metadata。启动和 Restore 使用该固定路径，不依赖目标机器的 PATH、Node 或 npm。

## package 与 make

- `package` / `package:beta`：生成未压缩的可运行应用目录，适合本机 smoke test。
- `make` / `make:beta`：先完成 package，再通过 Electron Forge ZIP maker 生成可分发 ZIP。

典型输出位置：

```text
gui/out/Codex Skin Theme Manager-win32-x64/
gui/out/make/zip/win32/x64/*.zip
```

`gui/out/` 是本机构建输出，不进入 Git。

## Build identity

`gui/scripts/forge-mode.mjs` 在 start/package/make 前从当前仓库解析完整 Git commit；无法验证时明确使用 `unavailable`。Forge 的 `packageAfterCopy` hook 把 mode、完整 commit 和七字符 short commit 写入 staging 中的 `build-mode.json`。

打包应用运行时不访问 `.git`，并忽略用于选择 mode 的环境变量。About、状态栏和 Diagnostics 从同一份构建身份读取应用版本、Build mode 和 commit。应用版本仍来自 `gui/package.json`。

## 发布前检查

建议从干净工作树构建，并完成：

```powershell
cd .\gui
npm test
npm run make:beta
```

随后把 ZIP 解压到独立目录进行 smoke test，至少确认：

- 应用可在没有系统 Node/PATH 依赖的环境启动。
- About 中的版本、Beta mode 和 Git commit 正确。
- Resource Root 只包含正式白名单资源。
- Apply、Launch、Diagnostics 导出和 Restore 可用。
- 用户数据写入 Electron userData，而不是解压或安装目录。

发布 ZIP 前应计算 SHA-256，并确保构建 commit 与准备发布的 Git tag 指向同一源码状态。
