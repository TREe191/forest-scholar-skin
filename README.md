# Codex Skin Theme Manager

Codex Skin Theme Manager 是一个面向 Codex Desktop 的本地主题管理器。它可以管理壁纸、Light/Dark 适配和受控的界面配色，并通过安全启动流程把选定主题应用到 Codex。

> 当前状态：**v1.0.0-beta.1 Public Beta**

这是一个非官方社区项目，与 OpenAI 或 HoYoverse 无隶属关系，也未获得其认可或背书。

## 主要功能

- 内置 **Forest Scholar** 和 **Phainon** 主题。
- 从本地 PNG/JPG 创建、复制和编辑用户自定义主题。
- 为 Light / Dark 分别设置壁纸，也可共用一张壁纸。
- 提供 **Fit / Fill / Focus** 三种常用壁纸布局。
- Universal UI adaptation 会根据 Codex 外观适配常用界面区域。
- Advanced palette overrides 提供实时 Codex UI mock preview，可查看颜色 token 的影响范围。
- Theme Manager 自身支持中文/English，以及 Light / Dark / System 外观。
- **Apply** 保存待使用的主题设置，**Launch** 启动并应用主题，**Restore** 恢复不带主题注入的原版 Codex。
- Beta 版提供 **Diagnostics / Support**，用于导出经过脱敏的启动诊断。

## 系统要求

- Windows x64。
- 已安装 Codex Desktop。
- 普通用户不需要安装 Node.js、npm 或其他开发工具；发行包已包含所需的 Node runtime。

## 下载与使用

1. 从本项目的 [GitHub Releases](https://github.com/TREe191/forest-scholar-skin/releases) 下载 `v1.0.0-beta.1` ZIP。
2. 将 ZIP **完整解压**到普通文件夹。不要直接在 ZIP 压缩包内运行程序。
3. 运行解压目录中的 `codex-skin-theme-manager.exe`。
4. 选择主题并按需调整壁纸、布局或 Advanced palette overrides。
5. 点击 **Apply** 保存选择。
6. 在点击 **Launch Codex** 前，完全退出所有 Codex 窗口，并等待后台 Codex 进程结束。
7. 点击 **Launch Codex**。

如果提示 Codex 仍在运行，请再次确认所有窗口和后台进程均已退出后重试。通常不需要管理员权限。

## Restore

**Restore Codex** 用于移除当前主题注入，并通过经过核验的原始应用身份重新启动不带调试参数的 Codex。以下情况建议使用 Restore：

- 暂时停用主题并回到原版 Codex。
- 主题启动中途失败，需要安全恢复。
- 不再使用本工具，准备删除解压目录。

在 Theme Manager 中点击 **Restore Codex**，等待操作完成即可。Restore 不会删除你的主题文件或聊天内容。

## Beta 诊断与反馈

Beta 版状态栏提供 **Diagnostics / Support**。遇到 Launch 失败时：

1. 打开 **Diagnostics / Support**。
2. 点击 **Export diagnostics** 或 **Report issue**。
3. 保存 diagnostics ZIP。
4. 提交问题时附上该 ZIP、应用版本、Build mode、Git short commit，以及失败前 Codex 是否已经完全退出。

诊断包只包含经过白名单筛选的启动、进程、监听和就绪状态信息，不包含聊天内容、账号数据、Cookie、Storage、网络正文或用户文件内容。详细说明见 [Beta / Support 指南](gui/BETA-SUPPORT.md)。

## Known Issues

- 某些机器上 Codex 已启动并建立本地监听后，调试连接仍可能未及时准备完成。Diagnostics 中通常显示为 `cdp-http-readiness`。
- 遇到问题时优先导出 Diagnostics，并附在反馈中；不要手工修改 `runtime/history`。
- 当前 Windows 发行包尚未进行代码签名，Windows 可能显示安全提示。请只从本项目 GitHub Releases 下载，并核对发布页提供的 SHA-256。
- Codex 更新可能改变界面结构；安全校验失败时工具会停止，而不会放宽身份或页面验证。

## Development / Build

开发机需要 Node.js 和 npm。最简开发入口：

```powershell
cd .\gui
npm install
npm start
```

也可在仓库根目录运行 `Start-ThemeManager.cmd`。Development、Beta、Production 的能力差异、bundled Node、资源路径和打包命令见 [BUILD-MODES.md](gui/BUILD-MODES.md)。

## License、素材与项目

- 原创软件代码使用 [MIT License](LICENSE)。
- 随附壁纸、主题美术和第三方或同人衍生素材不自动适用 MIT，详见 [ASSETS.md](ASSETS.md)。
- Created by **TREe191**。
- GitHub：[https://github.com/TREe191/forest-scholar-skin](https://github.com/TREe191/forest-scholar-skin)
