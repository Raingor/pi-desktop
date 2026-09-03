# 回归测试报告 · v0.8.3 优化批次

- 测试日期：2026-09-03（第二轮：测试脚本落仓库并加护栏后重跑）
- 被测产物：`release/mac-arm64/pi-desktop.app`（`npm run electron:build` 全新打包，Electron 43.5.1 / darwin arm64）
- 数据环境：真实 `~/.pi/agent/`（15 个会话、12 个项目、6 个供应商、60 条记忆），未使用 mock
- 结论：**通过**。自动化 322 项全绿，未发现回归，也未发现新缺陷。

| 层次 | 用例数 | 通过 | 失败 | 入口 |
|---|---|---|---|---|
| 单元测试（vitest） | 142 | 142 | 0 | `npm test` |
| 单元测试（node:test） | 3 | 3 | 0 | `npm test` |
| API 端到端（打包后真实 HTTP） | 61 | 61 | 0 | `npm run test:api` |
| UI 端到端（CDP 驱动打包应用） | 116 | 116 | 0 | `npm run test:ui` |
| 静态检查（tsc / eslint error） | — | 0 错误 | 0 | `npm run typecheck` / `lint` |
| **合计** | **322** | **322** | **0** | `npm run verify` + 两条 e2e |

第一轮的两套 e2e 脚本是 `/tmp` 里的一次性 shell 与 `.mjs`，跑完即删；本轮已全部改写成 TypeScript 落进 `test/e2e/`，纳入 `tsc -b` 与 `eslint`，并为每一类曾经误报的断言补了可在 CI 单独运行的单元测试（见 §5）。这也是用例数从 216 涨到 322 的原因：新增 34 条单测 + e2e 断言加密。

ESLint 另有 101 条 warning，全部是 React Compiler 的 `set-state-in-effect` / `immutability` 类建议与 `no-explicit-any`，按既定分层策略只提示不阻断，`npm run lint` 仍以 0 error 通过。

---

## 1. 测试方法

三层，都跑在**打包后的应用**上，而不是 dev server：

1. **API 层**：直接压 `http://127.0.0.1:51799`，覆盖路由表里全部 58 条路由中的可安全触发部分，含负向用例。
2. **UI 层**：Chrome DevTools Protocol 连上 renderer，用真实 DOM click / input 事件走完每个页面和每个控件；每一步同时收集 console error 与失败请求，避免"渲染出来了但其实是坏的"漏过去。
3. **进程层**：全程监控主进程 stdout，确认无 uncaught / unhandled / crash。

按钮定位一律用**可见文案或 aria-label**，不用内部 class 猜测——这一点在测试过程中直接暴露了 4 处脚本自身的错误断言（见 §5），说明这种定位方式确实能挡住"选择器写死了但页面已经变了"的假通过。

刻意**不触发**的操作：模型测速实跑（会消耗用户真实 token 与配额）、`POST /api/pi/settings|auth|models`（会改写真实配置）、记忆删除、`apply-updates`。这些留给人工确认。

---

## 2. API 端到端：47/47

### 只读 GET（26 项，全部 200）

`settings` `auth` `models` `builtin-providers` `codex-usage-status` `skills` `commands` `chat/active` `chat/default-directory` `official-usage-config` `usage` `sessions` `memory` `memory/config` `memory/status` `subagents` `trash` `copilot-config` `check-updates` `workspace/tasks` `usage-range`×4（today/7d/30d/custom） `chatgpt-usage-range` `packages/search`

实测返回的都是真实数据，不是空壳：`usage` 258KB、`skills` 24KB、`memory` 31KB、`builtin-providers` 9.6KB。

### 参数化 GET（7 项）

会话 id / 文件路径从上一步的 `/api/pi/sessions` 响应里取，不写死：

- `session-info` / `session-usage` / `session-history` / `session-preview` — 同一个会话四个视角一致
- `workspace/tree` / `workspace/file` / `workspace/review` — 目录、文件内容、git 状态

### 负向与守卫（8 项）

| 用例 | 期望 | 实测 |
|---|---|---|
| 未知路由 | 404 | `{"error":"Not found"}` |
| `task-output` 不存在的 id | 404 | `{"error":"task not found"}` |
| 跨站 Origin | 403 | `{"error":"cross-origin request rejected"}` |
| 非环回 Host | 403 | `{"error":"unexpected Host header"}` |
| 非环回 Host 带端口 | 403 | 同上 |
| 环回 Host 带端口 | 200 | 正常放行 |
| 畸形 JSON body | 400 | `{"error":"invalid JSON body"}`，**进程存活** |
| 空 command | 400 | `{"error":"empty command"}` |

畸形 body 这一条是本批次 P0 修复的直接验证：改造前裸 `JSON.parse` 会把异常抛到进程，打包环境下整个窗口消失。

### 长中文跨 chunk 往返（本批次 P0-b 的核心验证）

构造 90KB UTF-8 中文（31109 字，长度取奇数确保有字符横跨 16KB 读边界）作为 `task-run` 的 label 提交，再从 `workspace/tasks` 读回比对：

```
PASS  task-run 90KB Chinese label        200  {"id":"task-mtlrldcl-3969n"}
PASS  long-Chinese label round trip      31109 chars intact, no U+FFFD
```

逐字符相等、零个 U+FFFD。改造前 `raw += chunk` 会独立解码每个 chunk，边界字符必然损坏成替换字符，而 `JSON.parse` 依然成功——属于静默数据损坏，这是它唯一可靠的检测方式。

### 非破坏性 POST（4 项）

`chat/stop`（未知 session 返回 `stopped:false` 而非报错）、`provider-test`（不可达地址正确返回 `fetch failed` 而非抛出）、`task-stop`、`tasks-clear`、`sessions/auto-trash`。

---

## 3. UI 端到端：58/58

### 聊天工作台（12 项）

页面渲染、composer textarea、发送控件、思考深度选择器、侧栏真实会话列表（12 项目 / 15 会话）。

打开真实会话后：transcript 渲染出消息、9 行用量统计 + 会话元信息面板、composer 正确回显该会话最后使用的模型（`justwoker-k1 / claude-opus-5-thinking`，来自 `session-history` 的 `model` 字段）。模型选择器打开后列出 9 个可选模型。全程 0 console error、0 失败请求。

### 右侧工具面板（6 个 tab + 2 项专项）

| Tab | 实测内容 |
|---|---|
| 文件目录 | 列出项目真实目录树 |
| 审查 | git 状态：`main`、27 个已修改文件 |
| SubAgent | 7 条真实运行记录，含耗时与状态 |
| 后台任务 | 空闲态提示文案正确 |
| 浏览器 | 地址栏与快捷入口渲染 |
| 终端 | cwd 提示、无 TTY 说明 |

**目录跟随会话切换**（用户此前报的 bug）：切换会话后面板根目录从 `pi-desktop` 变为 `CC`，跟随生效。

**终端命令端到端**：输入 `echo 回归测试-OK && pwd`，回车，输出流式回显：

```
回归测试-OK
/Users/raingor_ye/wwwroot/M-my-notes/my-notes/CC
[exited code=0]
```

中文命令与中文输出都完整，且 cwd 是切换后的目录——同时验证了终端和目录跟随。

### 设置工作台七个页面（7 项，全部为独立 lazy chunk）

七个 chunk 全部加载成功，Suspense fallback 均已清除，无一卡在"载入中…"：

| 页面 | 实测 |
|---|---|
| 通用 | 六个子 tab 全渲染 |
| 概览与使用统计 | 13 个 tech-panel |
| 提供商与模型 | 54 个控件 |
| 子代理 | 三个 tab |
| 模型测速 | 6 个供应商列表 |
| 会话管理 | 15 会话 / 18 回收站 |
| 记忆 | 8908 字符真实内容 |

### 使用统计页专项（6 项）

时间范围切换（本批次时区改动的关键路径）：

| 范围 | 请求数 | 成本 |
|---|---|---|
| 当天 | 0 | $0.0000 |
| 7天 | 8 | $37.754 |
| 30天 | 18 | $39.464 |

数字随范围正确变化（改造前 UTC 分桶会让"当天"在东八区下午出现错位）。三个明细表：请求日志 18 行、Provider 统计 10 行、Model 统计 10 行。

### 会话管理专项（3 项）

目录树渲染；搜索无匹配时显示"没有找到匹配的会话"；回收站 tab 列出 18 条可恢复记录，0 console error。

### 子代理专项（4 项）

三个 tab 各自的空状态文案区分正确——这是本批次修的缺陷：`searchActive` prop 之前被传下去但没人读，导致搜索无结果时显示"暂无代理 / 在 ~/.pi/agent/agents/ 目录下创建 .md 文件"，让用户去创建其实已经存在的文件。现在：

- 代理 tab（无数据）→ "暂无代理" + 创建指引
- 流水线 tab（无数据）→ "暂无流水线" + `chains/` 指引
- 运行记录 tab（有数据）→ 7 条记录表格

### 通用设置六个子 tab（6 项）

外观 29 控件、模型 10、CLI 设置 39、Skills 7、命令 7、高级 25。均绑定到真实 `~/.pi/agent` 配置，无 console error。

### 菜单栏弹窗（2 项）

独立 window 渲染 Codex 官方配额（PLUS 已登录、5 小时窗口剩余 100%、每周窗口剩余 0% 且 3天9小时后重置）、今日 token 与成本、最近 7 天分日图表（共 4.71 亿 tokens / $37.75）。

### i18n（1 项）

语言菜单打开正常。本批次新增的 `subagents.no_match` / `no_match_desc` 已补齐 zh-CN / zh-TW / en / ja 四个语言文件。

---

## 4. 进程稳定性与产物

两轮 API sweep + 两轮完整 UI walk 之后：

- 主进程存活，无 uncaught / unhandled / crash 记录
- 唯一日志输出是 Node 自身的 `DEP0180 fs.Stats constructor is deprecated`，来自依赖，与本次改动无关
- RSS 约 293MB，无异常增长

**代码分割效果**（本批次 P1）：

| chunk | 体积 |
|---|---|
| main（入口） | 618K |
| DashboardPage | 450K |
| ProvidersModelsPage | 85K |
| SettingsPage | 58K |
| MemoryPage / SessionsPage | 21K / 20K |
| SubagentsPage / ModelSpeedTestPage | 15K / 13K |
| 合计 | 1.5M |

recharts 所在的 450K Dashboard chunk 与 85K 供应商编辑器已完全移出启动路径——启动只需 618K 入口，只有真正打开对应页面时才拉取。

---

## 5. 曾经的 5 个假失败：已修复并加上回归护栏

第一轮把这 5 条记为"测试脚本自身的错误断言"，但当时的修法是在 `/tmp` 的脚本里手改一次，而那两个文件在收尾清理时被删掉了——报告里描述的修复在仓库里根本不存在，5 类问题全都能原样复发。

本轮的做法是让每一类**在结构上不可能再发生**，而不是再手改一次。脚本已落仓库、纳入类型检查，每条护栏都有能在 CI 单独运行的单测。

| # | 原假失败 | 根因 | 现在为什么不会再犯 |
|---|---|---|---|
| 1 | `session-history` 传 `?session=` 拿不到数据 | 三个同族路由参数名不一致（邻居用 `session`，它用 `id`） | **改了产品代码**：三个路由统一接受两种拼写，[`sessionIdFromUrl()`](server/api-routes.ts:1) 单一实现 + [`api-routes.test.ts`](server/api-routes.test.ts:1) 6 条单测钉住；e2e 里两种拼写各跑一遍 |
| 2 | Host 守卫返回 502 | curl 对 127.0.0.1 也走 `http_proxy`，拿到的是代理的错误 | 换成 [`http-client.ts`](test/e2e/http-client.ts:1) 的裸 `node:http`：不读任何代理环境变量，且能真正伪造 `Host`/`Origin`（`fetch` 会重写 Host，做不到这件事）。传输层的选择本身就是这条测试 |
| 3 | 六个图标 tab 全点到第一个 | 按 textContent 匹配，图标按钮的 textContent 是空串，`"".includes("")` 恒真 | 定位逻辑抽成 [`indexByAccessibleName()`](test/e2e/locators.ts:35)：空查询直接抛错，`aria-label` → `title` → 文本优先级固定；[12 条单测](test/e2e/locators.test.ts:1) 覆盖，其中一条断言注入页面的表达式里**包含该函数的源码**，从而不可能出现第二份会漂移的实现；每次点击后还要断言 `aria-current` 真的移到了目标 tab |
| 4 | 文案写死且写错 | 脚本里手抄"今天 / 调用明细 / 链"，实际是"当天 / 请求日志 / 流水线" | 文案改为按 key 从**真实词典**取：[`label()`](test/e2e/labels.ts:41) 未知 key 直接抛错（不像 `t()` 会降级返回 key）；顺带发现 zh-TW 真缺一个 key（`providers_models.no_match`），已补 |
| 5 | 弹窗被判定坏掉 | popup 走 IPC 异步取数，脚本单帧采样抓到"加载使用量数据…"中间态 | 异步断言只保留轮询形态 [`Runner.waitFor()`](test/e2e/runner.ts:43)，失败时报告的是**最后一次实际观测到的状态**而不是"超时"；popup、lazy chunk、range 切换全部走这条路径 |

### 本轮重跑又抓出 2 类同样性质的问题

护栏生效的直接证据——这两条都是第一轮**没被发现**的假失败：

6. **`usage-range` 的字段名**：`/api/pi/usage` 把数字嵌在 `totals` 下，`/api/pi/usage-range` 是平铺的，脚本对两者都问 `totals.requests`，于是 4 个 range 全报 `? req`，看起来像 4 条坏路由。改为按 [`getUsageByRange()`](server/pi-reader.ts:1167) 的真实返回逐字段校验（缺哪个字段就报哪个字段名，不再打印问号），并新增 [`usage-range.test.ts`](server/usage-range.test.ts:1) 8 条单测，让 CI 在没有打包应用的环境里也能守住这个契约。同时加了一条与数据量无关的不变式：`today ≤ 7d ≤ 30d`——安静的一天里每个 range 都合法地是 0，只有这条还能抓出分桶错误。

7. **通用设置子页的面板选择器**：断言写的是 `.settings-page-inner section > 0`，这对用 `Card` 构建的 4 个子 tab 成立，但 Skills 与命令两页渲染的是裸 `div.skills-page`，于是两个健康的页面被判为空白。改为用兄弟选择器 `nav ~ *` 让 DOM 自己回答"面板在哪"，并要求文本**非空且与上一个 tab 不同**——空白页过不了第一条，点击没切换过不了第二条。这三个页面的中文是硬编码在组件里的，没有词典 key 可取，所以这里不能改成取文案，只能改成结构不变式。

---

## 6. 遗留与建议

不阻塞发布，记录备查：

- **101 条 lint warning**：React Compiler 的 `set-state-in-effect`（17 处）、`immutability`（5 处）、`refs`（1 处）分布在 6 个以上组件，每一处都是独立重构且各带回归风险，本批次按"提示不阻断"处理。
- **`src/hooks/useSessionUsage.ts` 是死代码**：全仓无引用，且其字段形状（`contextWindowRatio` / `cacheHitRatio`）与当前 API 返回不匹配，属于过期副本。本批次未删除。
- **`testModel` 的 `apiType` 参数被接受但忽略**：探测始终按 OpenAI 形状打 `/chat/completions`。已重命名为 `_apiType` 并加注释使其显式可见，未实现按类型路由——缺少可验证的真实供应商环境。
- ~~**路由参数命名不一致**~~：已于本轮修复，三个 session 路由都接受 `?session=` 与 `?id=`（§5 第 1 条）。
- **Skills / 命令 / CLI 设置三页文案硬编码**：不走 i18n 词典，所以 e2e 无法按 key 断言其文案，只能断言结构不变式。若这三页要支持多语言，需要先补词典 key。
- **未自动化的部分**：模型测速实跑、写配置类 POST、记忆删除、更新安装。原因是会消耗真实配额或改写用户数据，宜人工确认。

---

## 附：复现方式

```bash
npm run verify          # tsc + eslint + vitest 142 + node:test 3
npm run electron:build  # 打包

env -u ELECTRON_RUN_AS_NODE \
  ./release/mac-arm64/pi-desktop.app/Contents/MacOS/pi-desktop \
  --remote-debugging-port=9222 &

npm run test:api        # 61 项，压 127.0.0.1:51799
npm run test:ui         # 116 项，CDP 连 9222
```

两点必须注意：

- `ELECTRON_RUN_AS_NODE` 必须清掉。该变量存在时 Electron 会退化成纯 Node 运行，不开窗口，CDP 里也就没有任何 target。
- `--remote-debugging-port` 只有 `test:ui` 需要，`test:api` 不依赖它。端口可用 `PI_E2E_PORT` / `PI_E2E_CDP_PORT` 覆盖。

两套 e2e 是普通 `.ts` 文件，不匹配 vitest 的 `*.test.ts` 也不匹配 `node --test "test/**/*.js"`，所以 `npm test` 不会在没有打包应用的环境里去跑它们——CI 保持绿色，e2e 由人显式触发。
