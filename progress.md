# 工作进度

## 初始化规划
- 已创建：`task_plan.md`、`findings.md`、`progress.md`。
- 已运行 session catchup；未返回待同步上下文。
- 当前状态：全部阶段完成，已交付。

## 检查记录
- 当前与参考项目的 `git status --short` 未显示未提交变更。
- 未找到当前项目的 `.claude/RTK.md`；不影响规划初始化。
- 已完成参考项目初步勘察：它是一个 React/Vite 管理端加 Pi package 的大范围产品；当前建议只抽取“Pi 会话用量摘要命令”作为 MVP，避免复制完整桌面/Web 管理端。
- 已确认实现边界和 API 版本策略：使用当前 Pi 文档的 `registerCommand(name, { handler })`，不照搬参考项目的旧式 `ctx.say()` 命令 API。
- 已核对 Pi session JSONL 文档与本机实际 schema（仅检查字段名、未读取消息内容）；解析与汇总口径已记录到 `findings.md`。
- 已确认当前目录原本就是无提交的空 Git 仓库；已建立 package、extension、解析模块和 fixture 测试。

## 实现与验证（本轮）
- 新增：`package.json`、`src/usage.js`、`extensions/pi-usage-summary.js`、`test/usage.test.js`、`README.md`。
- 修复：重复 `today` 键（拆为 `todayDate`/`today`）、浮点成本断言（改容差比较）。
- 验证：`npm run check` ✅；`npm test` 3/3 ✅；真实验收 `pi -e ./extensions/pi-usage-summary.js -p "/pi-usage"` 输出真实今日/近 7 日与模型聚合 ✅。
- 交付报告已写入 `/Users/mac-2312-r/workspace/wwwroot/my-notes/香港集策/工作日志/pi-web-switch/2026-09-02-pi-desktop-usage-summary-交付报告.md`。
- 待办：产品文件尚未 git commit（由用户决定提交时机）。

## 2026-09-02 下午（续）
- [x] e05e1d4 修复语言菜单被项目对话列表遮挡（z-index 层叠）
- [x] f08af7b 窗口尺寸按屏幕自适应（82%/86% 工作区，最小 900×640）
- [x] 570a956 沉浸式顶栏：hiddenInset + 主题色窗口底色 + setWindowBackground IPC 同步
- [x] 5bcd0b2 使用统计滚动卡顿修复（去 6 处 backdrop-filter，125ms→16.6ms/帧）
- [x] 20309a7 全局隐藏滚动条
- [x] a493f75 按钮配色修复：bg-blue 子串选择器误伤 tab（黑字蓝底）→ 白字主题 token；全站硬编码状态色 token 化；双主题对比度审计清零
- 备注：审计曾误报两处（32bpp BMP 误读、切主题瞬间采样竞态），均以直接元素探针证伪
- [~] 曾按用户要求把聊天模型菜单改为仅 pi 内置模型；随后用户表示搞错了要求恢复 → git checkout 还原 ChatPage.tsx，重新打包运行（模型菜单恢复显示全部 provider，含 AgentRouter-a1/b.ai/justwoker）
- [x] fcf5df5 修复：导入/删除/改名提供商时丢弃 `_disabledProviders`（禁用提供商被从磁盘抹掉）+ updateCustomProvider 找不到已禁用条目导致加 key 报「保存失败」；端到端验证通过（模拟 provider 导入）
- [~] 曾按用户要求把聊天模型菜单改为仅 pi 内置模型；用户澄清搞错了 → 已还原
- [x] 78cee4f 目录菜单新增「在此目录发起对话」（/chat?project= 种子 + 手动改选清参数）
- [x] 4bcbe4a 侧栏与对话面板间可拖拽分隔条（200–480px，持久化，双击复位）
