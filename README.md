# Forest Scholar Skin — CDP MVP

这是 Forest Scholar Theme 的本机 CDP 版本。它通过本次启动的 Codex 所开放的本机 CDP，把 Forest Scholar 背景和一小段 CSS 加入 renderer；不会修改 WindowsApps、`app.asar`、MSIX 或签名文件。统一入口会自动跟随 Codex 自身的 Light / Dark 外观设置。

## 首次测试

1. 保存当前工作，并关闭所有 Codex 窗口。
2. 等待数秒，确认 Codex 已完全退出。
3. 双击 `Start-ForestScholar.cmd`。它会检测 Codex 当前外观，并在后续 Light / Dark 切换时自动同步背景和主题 class。
4. 启动器会从动态高位端口中选择一个空闲端口，只接受 `127.0.0.1` 监听；完成身份核验后才连接 renderer。

`Start-ForestScholar-Light.cmd` 和 `Start-ForestScholar-Dark.cmd` 继续保留，分别用于调试或手动指定初始模式；主题启动后仍会跟随 Codex 后续的外观切换。

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

## 文件与资源

- `assets/forest-scholar-light.png`：用户提供的 Light 最终背景，原样复制。
- `assets/forest-scholar-dark.png`：用户提供的 Dark 最终背景，原样复制。
- `assets/SHA256SUMS.txt`：资源 SHA-256。
- `styles/mvp.css`：仅背景层与主内容最小透明处理；未开始第二阶段组件样式重构。
- `scripts/Start-ForestScholarSkin.ps1`：安全启动与身份核验。
- `scripts/injector.mjs`：无第三方依赖的本机 CDP 注入器，并监听 Codex 根节点的主题信号以自动切换 Light / Dark 资源。
- `scripts/Disable-ForestScholarSkin.ps1`：运行中移除视觉注入。
- `scripts/Restore-ForestScholarSkin.ps1`：完整退出 CDP 并以原版方式重启。
- `runtime/`：首次运行后保存本次端口、PID、启动时间、Browser ID 和本地日志；不保存页面内容。

资源校验值：

```text
E65EA5FE9B0D47424C5727ED83D16D84508FECF9C2CDD6402FB99A857F9CB3AF  forest-scholar-light.png
988B7C56C9F05EBAD941453A21C8002587E32E8ABB8E0B68531D045645BC453E  forest-scholar-dark.png
```

## 已知限制与风险

- CDP 在本机不提供额外认证。虽然脚本强制并核验只监听 `127.0.0.1`，同一 Windows 用户下的其他本机进程仍可能尝试连接。因此不使用时应运行 Restore，而不只是 Disable。
- 首次实机启动前未重启当前 Codex；AppX 激活参数是否被当前版本完整接受，要以首次手动测试为准。
- Codex 更新后，DOM 结构标记可能变化。脚本会拒绝未通过核验的 renderer，而不是扩大探测范围。
- 这是 MVP：某些页面的原生不透明 surface 可能遮住部分背景；Settings、Work、Task、代码块和 Diff 尚未进行第二阶段处理。
- 背景以原比例 `contain` 并靠右居中显示，不会拉伸；窗口比例差异可能产生留白。
- 注入器把原始 PNG 作为本地 data URL 传入 renderer，会增加约数 MB 的运行时内存占用，但不会修改图片文件。
- 当前受限开发会话无法完整模拟用户桌面会话中的 AppX/AUMID 查询，因此首次测试若停在包注册解析，应保留错误窗口并反馈；脚本不会因此自动读取清单或访问安装目录。

## 完整卸载

先运行 `Restore-ForestScholarSkin.cmd`。确认原版 Codex 已重新打开后，关闭它，再删除整个 `forest-scholar-skin` 目录即可。项目没有安装服务、计划任务、注册表项、浏览器扩展或外部运行时。
