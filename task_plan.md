# Pi Agent 工具开发计划

## 目标
参考 `/Users/mac-2312-r/workspace/wwwroot/M-projects/pi-web-switch`，在当前 `pi-desktop` 项目中完成一个面向 Pi 的 Agent 工具；先厘清参考项目的架构、功能边界与可复用部分，再以最小实现交付并验证。

## 成功标准
- 参考项目的关键功能、技术栈与运行方式已记录。
- 新工具具备明确、可测试的最小功能范围。
- 实现仅包含需求所需内容，遵循 Pi 的工具/扩展约定。
- 自动化检查或手动验收通过。
- 完成后生成项目工作报告与对应工作日志。

## 阶段

### 阶段 1：项目勘察与需求边界
- [x] 查看 `pi-web-switch` 的目录、文档、依赖、入口和运行命令。
- [x] 查看当前项目的现状与已有约定。
- [x] 提炼应复用的能力及不应照搬的部分。
- **验证：** 已在 `findings.md` 记录技术结论、推荐 MVP 与待确认事项。

### 范围确认关口
- [x] 用户确认 MVP：`Pi 会话用量摘要命令`。
- [x] 已确认当前目录是空 Git 仓库；无需新建仓库，准备建立 Pi extension package 脚手架。

### 阶段 2：设计最小可行工具
- [x] 确定工具形态、输入/输出、用户交互和错误处理边界。
- [x] 确定目录结构、依赖和测试策略。
- [x] 用户已确认命令 MVP。
- **验证：** 设计：Pi package 的 `/pi-usage` 只读命令；解析 `~/.pi/agent/sessions` 的 JSONL assistant usage，按本地时区聚合今日/近 7 日，并显示会话数、请求数、Token、费用、模型。纯 Node.js 模块配 `node --test` fixture 测试。

### 阶段 3：实现
- [x] 按既定设计创建或修改最少必要文件。
- [x] 编写覆盖核心行为的测试或可重复验收脚本。
- **验证：** `node --check` 通过；`npm test` 3 个用例全部通过。

### 阶段 4：验证与修正
- [x] 运行项目既有检查（`npm run check`、`npm test`）。
- [x] 进行真实 Pi 调用验收（`pi -e ./extensions/pi-usage-summary.js -p "/pi-usage"`），真实会话数据输出正确。
- [x] 修复本次改动导致的问题（重复 `today` 键、浮点成本断言）。
- **验证：** 验收命令成功；真实数据今日/近 7 日汇总与模型聚合均正确输出。无残余风险。

### 阶段 5：交付记录
- [x] 汇总修改、验证结果和使用说明（项目内 `README.md` + 工作日志报告）。
- [x] 将项目工作日志保存到 `/Users/mac-2312-r/workspace/wwwroot/my-notes/香港集策/工作日志/pi-web-switch/`。
- **验证：** Markdown 报告与工作日志均已生成。

## 完成状态
- 第一轮（MVP `/pi-usage`）已交付并验收。

## 第二轮：codex/web-pi-chat 分支功能搬迁

### 阶段 6：源码搬迁
- [ ] 复制分支产品源码到 pi-desktop（排除 .git/node_modules/dist/对方 planning 文件）
- [ ] package.json 更名并接入 extensions/pi-usage-summary.js
- **验证：** 文件清单完整，git status 可见新增

### 阶段 7：安装与构建验证
- [ ] npm install
- [ ] npm run check / test / build（适用项）
- **验证：** 命令成功

### 阶段 8：运行时验收
- [ ] 启动 dev server，验证 API 端点
- [ ] 验证 /pi-usage 扩展仍可用
- **验证：** 端点返回正常 JSON

### 阶段 9：交付记录
- [ ] git commit
- [ ] 更新工作报告与工作日志
- **验证：** 记录已保存

## 当前决策
- MVP 已确定为 Pi package 中的 `/pi-usage` 会话用量摘要命令。
- 采用当前 Pi command API 与纯 Node.js ESM 实现；核心解析逻辑独立于 extension，使用 `node --test` 验证。
- 默认扫描 `~/.pi/agent/sessions`；仅读取 JSONL，不写入 Pi 配置或会话文件。

## 错误记录
| 错误 | 尝试 | 处理方式 |
|---|---:|---|
| 当前项目不存在 `.claude/RTK.md` | 1 | 未阻断；以已注入的项目规则为准，后续先检查实际项目文档。 |
| 规划技能模板位于工作区外，受 context-mode 文件沙箱限制 | 1 | 不重复绕过；依据技能给出的结构手动创建等效规划文档。 |
| 并行编辑调用的参数结构嵌套错误 | 1 | 改为独立、无嵌套的文件编辑调用，避免重复同一格式。 |
| 初次 Git 检查将无提交仓库误判为 Git 不可用 | 1 | 原因是 `git log` 在无提交时使组合命令失败；已以 `git init` 结果确认仓库存在，后续分离检查。 |
| 汇总对象中重复 `today` 键导致标签输出 `[object Object]` | 1 | 拆分为 `todayDate`（日期串）与 `today`（汇总桶）两个键。 |
| 浮点成本累加导致深度相等断言失败 | 1 | 测试改用容差断言（`< 1e-9`）而非严格相等。 |
