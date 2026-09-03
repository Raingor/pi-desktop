- [x] 2a4836a 同步 pi-web-switch 0.9.1：mergePiSettings（防嵌套配置丢失）+ PiSettings 类型扩充 + CLI 设置页 + Skills/Commands 页 + provider-import 密钥池模块；对端 UI 模式回退不适用（本端早已 chat-only 且 Sidebar 更强）
- [x] eb75708 设置→外观→界面风格：4 风格卡片（石墨/信号终端/暖琥珀/星紫），html[data-style] 变量集切换，持久化

---

## 2026-09-03 · 右侧工具面板（6 个工具）

**需求**：默认隐藏的右侧栏 + 右上角开合按钮；工具为 文件目录 / 审查 / SubAgent / 后台任务 / 浏览器 / 终端。

### 新增文件
- `server/workspace-tools.ts` — 目录树、文件预览、git status/diff、后台任务进程注册表
- `server/workspace-tools.test.ts` — 17 个用例（含 2 类路径穿越、非仓库、空命令、增量读取）
- `src/lib/workspace.tsx` — WorkspaceProvider / useWorkspace，共享当前项目目录
- `src/components/layout/RightPanel.tsx` — 图标轨 + 6 个面板的容器
- `src/components/tools/{Files,Review,Subagent,Tasks,Browser,Terminal}Panel.tsx`

### 改动文件
- `src/components/layout/AppShell.tsx` — 右侧栏 + 分隔条 + 切换按钮 + ⌘J + WorkspaceProvider 包裹
- `src/components/chat/ChatPage.tsx` — 把 projectPath / defaultCwd 同步进 WorkspaceContext
- `src/index.css` — +326 行面板样式（1771 → 2097）
- `server/api-routes.ts` — 10 条 workspace 路由 + `json()`/`readJson()` 辅助 + `Cache-Control: no-store`
- `electron/main.ts` — webviewTag、will-attach-webview 加固、setWindowOpenHandler、`pi:open:terminal`
- `electron/api-server.ts` — 固定端口 51799（原 listen(0)）
- `electron/preload.ts` / `electron/vite-env.d.ts` — openTerminal、webview JSX 声明
- `README.md` — 工具面板章节、API 45→55、结构树、安全说明

### 验证结果（打包应用 + CDP）
- `npx tsc -b` 0 错误；`npm test` **89 通过**（72 → 89）
- 10 条新路由全部 200；`../../..` 与 `../../../../../.ssh/id_rsa` 均被拒；跨源 text/plain POST 403
- 六面板节点数 141/67/399/11/29/17，全部有内容或正确空态，**0 JS 错误**
- 终端流式：`echo A1 && sleep 2 && echo A2 && sleep 2 && echo A3` → 逐段回显到 `[exited code=0]`
- webview 实测 `https://example.com/` 标题 `Example Domain`
- 布局：侧栏 264 + 聊天 814 + 面板 720 = 1798（窗口 1800），无横向溢出
- 打包 4 个产物（x64/arm64 × dmg/zip），app.asar 仍 2MB

### 顺带修掉的既有 bug
1. **偏好每次启动全丢** — 本地 API `listen(0)` 随机端口使渲染页 origin 每次变化，localStorage 按 origin 隔离，19 个键（界面风格、缩放、字号、语言、币种、侧栏宽度、上次模型、测速结果…）全部重置。改固定端口 51799。
2. **`/api/pi/*` 可被浏览器缓存** — 重复 GET 同 URL 命中内存缓存，轮询类接口会永远读到第一次的响应。统一加 `Cache-Control: no-store`。
3. **拖拽宽度持久化写错值** — 同一 React 批次内 pointerdown/move/up 不重渲染，handler 闭包是旧值。改从 move 里更新的 ref 读取（侧栏、面板同此修复）。
