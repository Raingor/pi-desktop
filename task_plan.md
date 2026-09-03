# 任务：右侧工具栏（6 个面板）

## 目标
在 pi-desktop 聊天界面加一个默认隐藏的右侧栏，右上角有显示/隐藏按钮，内含 6 个工具面板：
文件目录 · 审查 · SubAgent · 后台任务 · 浏览器 · 终端

## 阶段

### Phase 1 — 布局骨架 `complete`
AppShell 加右侧栏容器 + 可拖拽分隔条 + 右上角切换按钮（另加 ⌘J）。默认隐藏，开合/宽度/所在标签持久化。
verify: ✅ 默认隐藏、按钮距右 12px 距顶 30px、点击展开 380px、拖拽 280–720px、刷新后状态保留

### Phase 2 — 工作目录共享 `complete`
新建 `src/lib/workspace.tsx`（WorkspaceProvider/useWorkspace）。ChatPage 用 effect 把 `projectPath || defaultCwd` 写进去，右侧栏读取。
verify: ✅ 文件/审查/终端三个面板标题显示 pi-desktop / main，切项目跟着变

### Phase 3 — 后端能力 `complete`
`server/workspace-tools.ts` + api-routes 挂 10 条路由。
verify: ✅ 打包应用内 10 条全 200；路径穿越 2 类攻击被拒；跨源 text/plain POST 403

### Phase 4 — 6 个面板实现 `complete`
verify: ✅ 逐个实测——文件 21 项可进目录可预览文本；审查 13 改动 diff 67 行着色；SubAgent 7 代理 46 记录；
后台任务记录+终止（已终止 · 4.1s）；浏览器 webview 真加载 example.com；终端 A1→A2→A3 流式回显

### Phase 5 — 验证与交付 `complete`
verify: ✅ tsc 0 错 / 89 测试通过 / 4 个安装包 / CDP 全流程 0 JS 错误 / 无横向溢出

## 关键决策
- **终端不用 node-pty**：native 模块要按 Electron ABI 重建，且 build.files 排除 node_modules（asar 仅 2MB），引入会破坏打包设计。改用 `spawn($SHELL -lc)` + 轮询字节偏移，能跑命令/看输出/送 stdin/Ctrl-C，但没有 TTY。另给"在系统终端打开"（新 IPC `pi:open:terminal`）兜底。
- **浏览器用 `<webview>`**：iframe 会被 X-Frame-Options 挡。开 `webviewTag: true` 后在主进程 `will-attach-webview` 里剔除 guest preload / 关 node 集成 / 拒非 http(s) src，并把 guest 开新窗转给系统浏览器。
- **文件面板限定在项目根内**：`resolveInRoot()` 做字符串前缀校验，listDirectory/readTextFile/gitDiff 全部走它。
- **后台任务用有界环形缓冲**：输出上限 256KB、任务数上限 40，客户端按 `since` 字节偏移增量拉取，`dropped` 标记告知早期输出已丢。防 `yes` 之类跑飞把服务端内存吃光。

## 错误记录
| 错误 | 尝试 | 解决 |
|------|------|------|
| tsc: `code[0]` 可能 undefined（TS2538/TS2322 共 5 处） | 1 | 加显式存在性判断与 `?? ""` 兜底 |
| 浏览器面板 webview 死活不出现 | 1 | 找到鸡生蛋：`go()` 里 `setCurrent` 被 `viewRef.current` 守卫，而 webview 只在 current 非空时才渲染 → ref 永远是 null。去掉守卫，改为先 setCurrent，ref 存在时再额外赋 src |
| 终端输出时有时无（同一次命令，有时只显示第一段） | 1（猜 StrictMode 双调用）→ 2（猜 effect cleanup）→ 3（加 console.log 实测） | 日志显示轮询正常。真因两条：① 重复 GET 同一 URL 被 Chromium 内存缓存命中，轮询永远拿到第一次的空响应 → 服务端给 `/api/pi/*` 统一加 `Cache-Control: no-store`；② 窗口失焦时 Chromium 把链式 setTimeout 节流到秒级，测试脚本等 4s 不够 |
| 拖拽后 localStorage 存的还是旧宽度 | 1 | pointerdown/move/up 落在同一 React 批次时不会重渲染，handler 闭包仍是拖动前的值。改为在 move handler 里更新 ref，pointerup 从 ref 读 |
| 应用每次启动偏好全丢（不只本功能） | 1 | `server.listen(0)` 每次拿随机端口 → 渲染页 origin 变化 → localStorage 是按 origin 隔离的，19 个偏好键（界面风格/缩放/字号/语言/币种/侧栏宽/上次模型/测速结果…）每次启动全部重置。改为固定端口 51799，占用时向上试 24 个，最后才退回临时端口 |
