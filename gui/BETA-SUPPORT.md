# Beta Diagnostics / Support

当前 Beta 版可以作为完整 ZIP 独立分发。完整解压后即可运行，普通测试用户不需要安装 Node.js 或 npm。

## 启动前

点击 **Launch Codex** 前，请先：

1. 保存 Codex 中正在进行的工作。
2. 关闭所有 Codex 窗口。
3. 等待后台 Codex 进程完全结束。
4. 再从 Theme Manager 点击 **Launch Codex**。

Launch 失败时，不要首先改用管理员权限。大多数失败与 Codex 尚未完全退出、启动就绪时间或安全身份校验有关；提升权限通常不能解决这些问题，还会改变复现环境。

## 常见失败类型

Diagnostics 中可能出现以下阶段名称。它们用于定位问题，不要求用户理解底层调试协议。

- `existing-codex-check`：检测到 Codex 仍在运行。请完全退出 Codex，等待后台进程结束后重试。
- `cdp-listener-readiness`：Codex 已启动，但本地调试监听没有按预期建立。请完全退出 Codex 后重试；若再次发生，请导出 Diagnostics。
- `cdp-http-readiness`：Codex 已启动且监听存在，但调试连接没有准备完成。请完全退出 Codex 后重试；若问题持续，请导出 Diagnostics。
- `renderer-readiness`：已经连接到 Codex，但目标界面没有在安全等待范围内准备完成。请退出 Codex、重新启动，并在重复出现时导出 Diagnostics。
- Path / process identity failure：启动器发现可执行路径、进程关系、包身份或监听所有权与预期不一致。工具会停止以保护当前会话；不要绕过校验，请附 Diagnostics 提交问题。

## 导出 Diagnostics

Beta 状态栏中提供 **Diagnostics / Support**：

1. 打开 **Diagnostics / Support**。
2. 点击 **Export diagnostics**。部分 Launch 失败会直接显示 **Report issue**，它使用同一个导出功能。
3. 在保存对话框中选择 diagnostics ZIP 的位置。

导出只读取最近一次启动会话，并生成新的脱敏 `diagnostics.json`。其中可能包括：

- 应用版本、Beta build mode、完整及短 Git commit。
- 失败阶段和有限的时间线事件。
- 启动 PID、监听所有权及经过校验的父子/祖先关系证据。
- `/json/version` 尝试次数、时间戳和经过白名单限制的失败类型。
- HTTP 状态码或安全的错误代码（如存在）。
- renderer 和 injector 是否到达相应就绪阶段。

不会导出：

- 聊天或输入内容。
- 账号数据。
- Cookie、Storage 或登录信息。
- 网络请求或响应正文。
- 用户文件、壁纸或主题内容。
- 完整命令行、任意错误正文或原始日志文件。

Diagnostics 不会自动上传到网络。取消保存不会创建 ZIP，导出失败也不会修改原始记录。

## 提交 Bug

提交 Issue 或反馈时，请附上：

- diagnostics ZIP。
- Theme Manager 的 Beta version 和 build commit（可在 About 或状态栏查看）。
- 是否以普通用户权限运行；除非特别说明，建议保持普通权限复现。
- 点击 Launch 前 Codex 是否已经完全退出，包括后台进程。
- 简短的复现步骤，以及问题是否稳定重复出现。

请不要手工修改、拼接或删除 `runtime/history` 来尝试修复问题。该目录是内部运行记录；修改后可能让下一份 Diagnostics 无法准确反映失败现场。需要恢复原版 Codex 时，请使用 Theme Manager 的 **Restore Codex**。
