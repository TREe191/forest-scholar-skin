# Forest Scholar Skin — CDP v0.3

这是 Forest Scholar Theme 的本机 CDP 版本。它通过本次启动的 Codex 所开放的本机 CDP，把所选 Theme Package 的背景和 CSS 加入 renderer；不会修改 WindowsApps、`app.asar`、MSIX 或签名文件。v0.3 使用 Manifest 和通用 Theme Loader，Forest Scholar 是第一套正式主题包。

## 首次测试

1. 保存当前工作，并关闭所有 Codex 窗口。
2. 等待数秒，确认 Codex 已完全退出。
3. 确认 `config/app.json` 中的 `activeTheme` 和 `appearance`，然后双击 `Start-ForestScholar.cmd`。
4. 启动器会从动态高位端口中选择一个空闲端口，只接受 `127.0.0.1` 监听；完成身份核验后才连接 renderer。

`appearance` 支持 `auto`、`light`、`dark`。`auto` 会跟随 Codex 自身的当前外观及后续切换；固定值会保持对应变体。`Start-ForestScholar-Light.cmd` 和 `Start-ForestScholar-Dark.cmd` 会临时覆盖本次启动的 appearance，但不会修改 `app.json`。

## 桌面快捷方式

首次使用时双击 `Install-Shortcuts.cmd`，桌面会创建：

- `Forest Scholar`：指向项目中的统一自动入口。
- `Restore Forest Scholar`：指向项目中的完整恢复入口。

安装过程不需要管理员权限，不写注册表，也不创建开机自启。项目目录移动后，快捷方式会自然失效。双击 `Remove-Shortcuts.cmd` 可删除上述快捷方式；它也会清理早期版本可能留下的 Light / Dark 快捷方式，但不会删除项目文件。

启动器不会自动关闭已经运行的 Codex。如果检测到任何 `ChatGPT.exe` 进程，它会停止并要求先手动关闭，以免中断当前任务。

## Disable 与 Restore

- `Disable-ForestScholarSkin.cmd`：移除注入的背景、样式和后续页面脚本，但保持当前 Codex 运行。由于 Electron 的调试端口属于本次 Codex 进程，CDP 监听会持续到 Codex 退出。
- `Restore-ForestScholarSkin.cmd`：先移除注入，再关闭经过包注册路径核验的 Codex 进程，最后通过同一 AppUserModelId 重新启动不带 CDP 参数的原版 Codex。这是推荐的立即完整恢复方式。

如果启动中途失败，启动器会在已能安全核验进程身份的情况下关闭该次启动的实例，并尝试重新打开不带 CDP 的原版 Codex。

## MVP 做了什么

- 只查询当前用户的 `OpenAI.Codex` AppX 注册信息与 `Get-StartApps` 结果来解析 AppUserModelId；不读取 `AppxManifest.xml`。
- 仅在 `49152–65535` 范围内随机选择当时空闲的端口。
- 启动参数固定包含 `--remote-debugging-address=127.0.0.1`。
- 在连接前及运行中反复核验监听地址、监听 PID 的可执行路径、Browser WebSocket ID、`app://` target 与少量布尔 DOM 标记。
- DOM 探测不读取 `textContent`、`innerText`、输入值、Cookie、存储、账户信息、聊天内容或应用网络内容。
- 注入器只创建自己命名的 style、背景 div、根节点属性和 class；Disable / Restore 只清理这些命名对象。
- v0.2 使用独立纯函数布局引擎，根据图片固有尺寸、viewport 和主题配置计算精确像素 `background-size` / `background-position`；布局算法不读取 DOM、文件或 CDP。
- renderer 通过 `ResizeObserver` 观察 viewport，并用 `requestAnimationFrame` 合并连续缩放更新；尺寸未变化时不会重复计算或写入样式。
- v0.3 通过 `config/app.json` 选择 Theme Package，Theme Loader 统一加载 Manifest、Light/Dark PNG、布局与可选 CSS；injector 不再知道具体主题资源路径。

## 背景布局配置

每个主题包有自己的 `layout.json`，公共结构由 `themes/layout.schema.json` 描述。Forest Scholar 的配置位于 `themes/forest-scholar/layout.json`。

支持四种通用模式：

- `contain`：完整显示图片，不主动裁剪。
- `cover`：铺满 viewport，允许标准居中/锚点裁剪。
- `focus-lock`：优先让焦点区域完整进入安全区域；无法满足时明确报告约束失败。
- `focus-soft`：在铺满画面和焦点可见性之间折中，允许 `focusTolerance` 指定的有限裁剪。

`focalRegion` 与 `anchor` 使用 0–1 归一化坐标；`offset.x/y` 使用 viewport 比例；`safePadding` 使用 CSS 像素。`scale` 是相对当前模式基础缩放的倍率，`minScale` / `maxScale` 是最终图片缩放边界。布局引擎返回裁剪信息、焦点实际/安全可见矩形、可见比例与约束状态，供未来预览界面复用。

离线运行通用几何测试：

```powershell
node --test .\test\layout-engine.test.mjs
```

## Theme Package Format

每套主题位于 `themes/<theme-id>/`，最小结构如下：

```text
themes/example-theme/
├─ theme.json
├─ layout.json
├─ assets/
│  ├─ light.png
│  └─ dark.png
└─ styles/
   └─ theme.css
```

最小 Manifest：

```json
{
  "schemaVersion": 1,
  "id": "example-theme",
  "name": "Example Theme",
  "version": "1.0.0",
  "author": "Theme author",
  "description": "A local Codex theme.",
  "variants": {
    "light": { "background": "assets/light.png" },
    "dark": { "background": "assets/dark.png" }
  },
  "layout": "layout.json",
  "styles": ["styles/theme.css"],
  "capabilities": {
    "light": true,
    "dark": true,
    "autoAppearance": true
  }
}
```

schemaVersion 1 只接受 package 内的相对路径和 PNG 背景。禁止绝对路径、UNC、URI、`..`、反斜杠、路径逃逸以及解析到 package 外的 symlink/junction。Theme CSS 可省略；存在时会随当前主题加载。

Theme CSS 不是完整沙箱，仍可改变 renderer 的视觉与布局。v0.3 会拒绝 `@import`、`url()`、`@font-face`、网络/file/data/blob URI、`expression()`、`behavior:` 和反斜杠转义，不会执行主题 JavaScript，也不会为主题开放网络能力。

添加第二套本地主题时，创建上述目录并通过 Schema/Loader 校验，然后把 `config/app.json` 的 `activeTheme` 改为新 ID。无需修改 injector 或布局引擎。非法 ID、无效 Manifest 或缺失资源会直接停止启动，不会回退到 Forest Scholar。

## 文件与资源

- `config/app.json`：当前主题和 appearance 选择。
- `themes/theme.schema.json`：Theme Manifest JSON Schema。
- `themes/layout.schema.json`：布局配置 JSON Schema。
- `themes/forest-scholar/`：Forest Scholar Manifest、布局、主题 CSS 和原始 Light/Dark 资源。
- `styles/base.css`：背景层、pointer-events 与 app root 的通用基础样式。
- `styles/codex-compat.css`：Sidebar、Composer、New Chat、Work 等 Codex 结构适配，只引用主题变量。
- `scripts/theme-loader.mjs`：Theme Package 读取、标准化、路径边界、PNG 与 CSS 安全验证。
- `scripts/layout-engine.mjs`：无 DOM/文件/CDP 依赖的纯布局计算模块。
- `scripts/Start-ForestScholarSkin.ps1`：安全启动与身份核验。
- `scripts/injector.mjs`：无第三方依赖的本机 CDP 注入器，并监听 Codex 根节点的主题信号以自动切换 Light / Dark 资源。
- `scripts/Disable-ForestScholarSkin.ps1`：运行中移除视觉注入。
- `scripts/Restore-ForestScholarSkin.ps1`：完整退出 CDP 并以原版方式重启。
- `runtime/`：首次运行后保存本次端口、PID、启动时间、Browser ID 和本地日志；不保存页面内容。

资源校验值：

```text
E65EA5FE9B0D47424C5727ED83D16D84508FECF9C2CDD6402FB99A857F9CB3AF  themes/forest-scholar/assets/light.png
988B7C56C9F05EBAD941453A21C8002587E32E8ABB8E0B68531D045645BC453E  themes/forest-scholar/assets/dark.png
```

## 已知限制与风险

- CDP 在本机不提供额外认证。虽然脚本强制并核验只监听 `127.0.0.1`，同一 Windows 用户下的其他本机进程仍可能尝试连接。因此不使用时应运行 Restore，而不只是 Disable。
- 首次实机启动前未重启当前 Codex；AppX 激活参数是否被当前版本完整接受，要以首次手动测试为准。
- Codex 更新后，DOM 结构标记可能变化。脚本会拒绝未通过核验的 renderer，而不是扩大探测范围。
- 这是 MVP：某些页面的原生不透明 surface 可能遮住部分背景；Settings、Work、Task、代码块和 Diff 尚未进行第二阶段处理。
- 背景保持原比例，并由 `focus-soft` 配置优先保留右侧主体；极端窗口比例下仍可能裁剪非焦点区域，若配置约束无法满足，布局结果会明确标记失败。
- 注入器把原始 PNG 作为本地 data URL 传入 renderer，会增加约数 MB 的运行时内存占用，但不会修改图片文件。
- 当前受限开发会话无法完整模拟用户桌面会话中的 AppX/AUMID 查询，因此首次测试若停在包注册解析，应保留错误窗口并反馈；脚本不会因此自动读取清单或访问安装目录。

## 完整卸载

先运行 `Restore-ForestScholarSkin.cmd`。确认原版 Codex 已重新打开后，关闭它，再删除整个 `forest-scholar-skin` 目录即可。项目没有安装服务、计划任务、注册表项、浏览器扩展或外部运行时。
